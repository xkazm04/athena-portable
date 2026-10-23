/**
 * First launch (Bell's welcome, athena-mini-window): who she is, the three promises, and whether
 * her engine was found, from what the probe found rather than what is stored.
 */
import { Icon } from "./icons";
import type { CompanionModel, EngineView } from "./model";

/**
 * The engine line. A tick means a probe found it; until one has answered there is no tick, and when
 * the engine is missing the mark is amber, a triangle, with the remedy and a way to look again.
 */
function EngineFact({ view, actions }: { view: EngineView; actions: CompanionModel["actions"] }) {
  const icon = view.state === "ready" ? "check" : view.state === "missing" ? "warn" : "wait";
  return (
    <li className="wl-engine" data-engine={view.state}>
      <Icon name={icon} className={view.state === "ready" ? "ok" : view.state === "missing" ? "warn" : "wait"} />
      <span role="status">
        <b>{view.text}</b> {view.sub}
        {view.state === "missing" ? (
          <span className="wl-engine-act">
            {view.retry ? (
              <button type="button" className="aw-btn aw-btn-sm" data-act="retry-engine" onClick={() => actions.retryEngine(view.retry!.id)}>
                {view.retry.label}
              </button>
            ) : (
              <button type="button" className="aw-btn aw-btn-sm" data-act="check-engines" disabled={view.checking} onClick={actions.checkEngines}>
                {view.checking ? "Checking…" : "Check again"}
              </button>
            )}
            {view.offer ? (
              <button type="button" className="aw-btn aw-btn-sm" data-act="use-engine" onClick={() => actions.useEngine(view.offer!.id)}>
                Use {view.offer.label}
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function Welcome({ model }: { model: CompanionModel }) {
  const { actions } = model;
  const view = model.welcome.engineView;
  return (
    <div className="wl" data-missing={view.state === "missing" ? "1" : "0"}>
      <div className="wl-body">
        <div className="wl-top">
          <p className="eyebrow">First launch</p>
        </div>
        <h2 className="wl-title">Athena is here.</h2>
        <p className="wl-copy">
          She works inside the web apps you already have open. She reads one page, decides, acts in another, and asks you
          before anything that cannot be undone.
        </p>
        <ul className="wl-list">
          <EngineFact view={view} actions={actions} />
          <li>
            <Icon name="eye" />
            <span>
              <b>She reads the page you are on.</b> Nothing leaves it unless you say so.
            </span>
          </li>
          <li>
            <Icon name="hand" />
            <span>
              <b>She asks first.</b> Every send, void or payment waits for your A or D.
            </span>
          </li>
          <li>
            <Icon name="lock" />
            <span>
              <b>It all runs on this machine.</b> No account, no cloud, no telemetry.
            </span>
          </li>
        </ul>
      </div>
      <div className="wl-foot">
        <button type="button" className="aw-btn aw-btn-main" data-act="open" onClick={actions.open}>
          Open your first app <kbd>Enter</kbd>
        </button>
        <button type="button" className="aw-btn aw-btn-ghost" data-act="later" onClick={actions.later}>
          Later <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
