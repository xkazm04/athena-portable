//! The respawn ladder: what the shell does when the daemon it owns goes away (ADR 0206, amending
//! ADR 0015).
//!
//! Pure policy, no process in it. The supervisor in `daemon.rs` tells the ladder how a run ended
//! and gets back a [`Plan`]: start it again after a delay, or stop and say why. Three rules:
//!
//! 1. **Bounded.** Delays double from [`BASE_DELAY`] to a [`DELAY_CEILING`]; after
//!    [`MAX_ATTEMPTS`] consecutive unproductive deaths the ladder gives up and the status says how
//!    many, so a daemon that crashes on every start costs a handful of spawns, not an evening.
//! 2. **Reset by a productive round, not a connection.** A run that stayed ready for
//!    [`RESET_WINDOW`] did real work; its death starts the ladder again at the first rung. A run
//!    that reached ready and died a second later is one more rung.
//! 3. **A declared verdict is never retried.** A daemon that printed a refusal (`{"ok": false}`)
//!    or answered `/health` with 401 has said why it will not run; starting it again gets the same
//!    sentence. A daemon that died before it was ever ready on a person's start is a broken
//!    install, not a crash, and is reported the same way.
//!
//! Who cancels a pending respawn is not here: the generation counter in `daemon.rs` is, so a
//! person's restart or an app exit wins over any rung.

use std::time::Duration;

/// The first rung's wait.
pub const BASE_DELAY: Duration = Duration::from_secs(1);
/// No rung waits longer than this.
pub const DELAY_CEILING: Duration = Duration::from_secs(30);
/// Consecutive unproductive deaths the ladder absorbs; the next one is a verdict.
pub const MAX_ATTEMPTS: u32 = 5;
/// How long a run must stay ready to count as productive and reset the ladder.
pub const RESET_WINDOW: Duration = Duration::from_secs(60);

/// How one run of the daemon ended, as the supervisor observed it. Typed by the wait that ended,
/// never re-inferred from the wreckage.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ending {
    /// `/health` answered 200, the daemon served for `ready_for`, then its stdout closed.
    AfterReady { ready_for: Duration },
    /// stdout closed before the daemon was ever ready (no ready line, or no 200 in budget).
    BeforeReady,
    /// The daemon printed `{"ok": false, ...}` and then exited.
    Refused,
    /// `/health` answered 401 to this shell's token.
    Unauthorized,
}

/// Why the ladder stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// The run ended in a sentence of its own (a refusal, a 401, a broken first start); keep it.
    Declared,
    /// `deaths` consecutive unproductive deaths; the ladder is exhausted.
    Exhausted { deaths: u32 },
}

/// What the supervisor does next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    /// Start the daemon again after `after`; this is attempt `attempt` of [`MAX_ATTEMPTS`].
    Respawn { attempt: u32, after: Duration },
    /// Stop, with this verdict on the status. No further spawn is scheduled.
    GiveUp(Verdict),
}

impl Plan {
    /// The sentence the status carries for this plan. `kept` is the run's own ending sentence,
    /// used when the verdict is declared.
    pub fn sentence(&self, kept: &str) -> String {
        match self {
            Self::Respawn { attempt, after } => format!(
                "the daemon exited; starting it again in {}s (attempt {attempt} of {MAX_ATTEMPTS})",
                after.as_secs()
            ),
            Self::GiveUp(Verdict::Declared) => kept.to_string(),
            Self::GiveUp(Verdict::Exhausted { deaths }) => {
                format!("the daemon exited {deaths} times in a row; restart it from Settings")
            }
        }
    }
}

/// The rung the daemon is on. `attempt` is how many respawns the current run of deaths has
/// already scheduled; 0 means the daemon running now was started by a person (or at launch).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ladder {
    attempt: u32,
}

impl Ladder {
    #[cfg(test)]
    pub fn attempt(&self) -> u32 {
        self.attempt
    }

    /// A person started the daemon: whatever rung it was on no longer applies.
    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    /// Decide what follows `ending`, and move to that rung.
    pub fn on_exit(&mut self, ending: Ending) -> Plan {
        match ending {
            Ending::Refused | Ending::Unauthorized => return Plan::GiveUp(Verdict::Declared),
            // A person's start that never came up is a broken install: say its own sentence.
            // On a rung, a respawn that dies before ready is one more unproductive death.
            Ending::BeforeReady if self.attempt == 0 => return Plan::GiveUp(Verdict::Declared),
            Ending::AfterReady { ready_for } if ready_for >= RESET_WINDOW => self.reset(),
            Ending::AfterReady { .. } | Ending::BeforeReady => {}
        }
        if self.attempt >= MAX_ATTEMPTS {
            return Plan::GiveUp(Verdict::Exhausted {
                deaths: self.attempt,
            });
        }
        self.attempt += 1;
        Plan::Respawn {
            attempt: self.attempt,
            after: delay(self.attempt),
        }
    }
}

/// The wait before respawn `attempt` (1-based): doubling from [`BASE_DELAY`], capped.
pub fn delay(attempt: u32) -> Duration {
    let doublings = attempt.saturating_sub(1).min(16);
    BASE_DELAY
        .saturating_mul(1u32 << doublings)
        .min(DELAY_CEILING)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BRIEF: Ending = Ending::AfterReady {
        ready_for: Duration::from_secs(3),
    };

    #[test]
    fn a_death_after_ready_is_respawned_after_one_second() {
        let mut ladder = Ladder::default();
        let plan = ladder.on_exit(BRIEF);
        assert_eq!(
            plan,
            Plan::Respawn {
                attempt: 1,
                after: Duration::from_secs(1)
            }
        );
        assert_eq!(
            plan.sentence("the daemon exited"),
            "the daemon exited; starting it again in 1s (attempt 1 of 5)"
        );
        assert_eq!(ladder.attempt(), 1);
    }

    #[test]
    fn five_unproductive_deaths_double_the_wait_and_the_sixth_gives_up() {
        let mut ladder = Ladder::default();
        let mut delays = Vec::new();
        for _ in 0..5 {
            match ladder.on_exit(BRIEF) {
                Plan::Respawn { after, .. } => delays.push(after.as_secs()),
                other => panic!("expected a respawn, got {other:?}"),
            }
        }
        assert_eq!(delays, vec![1, 2, 4, 8, 16]);
        let sixth = ladder.on_exit(BRIEF);
        assert_eq!(sixth, Plan::GiveUp(Verdict::Exhausted { deaths: 5 }));
        assert_eq!(
            sixth.sentence("the daemon exited"),
            "the daemon exited 5 times in a row; restart it from Settings"
        );
        // Exhausted stays exhausted: nothing schedules another spawn until a person resets it.
        assert!(matches!(ladder.on_exit(BRIEF), Plan::GiveUp(_)));
        // The ceiling holds past the rungs this ladder uses.
        assert_eq!(delay(6), Duration::from_secs(30));
        assert_eq!(delay(40), DELAY_CEILING);
    }

    #[test]
    fn a_productive_round_resets_the_ladder() {
        let mut ladder = Ladder::default();
        for _ in 0..3 {
            ladder.on_exit(BRIEF);
        }
        assert_eq!(ladder.attempt(), 3);
        let plan = ladder.on_exit(Ending::AfterReady {
            ready_for: RESET_WINDOW,
        });
        assert_eq!(
            plan,
            Plan::Respawn {
                attempt: 1,
                after: Duration::from_secs(1)
            }
        );
    }

    #[test]
    fn a_declared_verdict_is_never_retried() {
        let refusal = "the daemon refused to start (engine_unavailable): no claude on PATH";
        for ending in [Ending::Refused, Ending::Unauthorized] {
            for rung in 0..3 {
                let mut ladder = Ladder::default();
                for _ in 0..rung {
                    ladder.on_exit(BRIEF);
                }
                let plan = ladder.on_exit(ending);
                assert_eq!(
                    plan,
                    Plan::GiveUp(Verdict::Declared),
                    "{ending:?} on {rung}"
                );
                assert_eq!(plan.sentence(refusal), refusal);
            }
        }
    }

    #[test]
    fn a_first_start_that_never_comes_up_is_reported_but_a_rung_that_does_not_climbs() {
        let mut ladder = Ladder::default();
        assert_eq!(
            ladder.on_exit(Ending::BeforeReady),
            Plan::GiveUp(Verdict::Declared)
        );
        let mut ladder = Ladder::default();
        ladder.on_exit(BRIEF);
        assert_eq!(
            ladder.on_exit(Ending::BeforeReady),
            Plan::Respawn {
                attempt: 2,
                after: Duration::from_secs(2)
            }
        );
    }
}
