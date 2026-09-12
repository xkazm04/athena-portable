"""The connector seam, and nothing else (README §4, §6 layout).

``port.py`` is the whole package in this build: the connectors — their specs, their vault, their
OAuth — are another team's, in another repository. What is fixed here is how they enter the
catalog, so that when they arrive there is no merge fight over the gate.
"""

from athena.connectors.port import ConnectorPort

__all__ = ["ConnectorPort"]
