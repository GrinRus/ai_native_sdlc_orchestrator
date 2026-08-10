import { Alert } from "./ui/components.jsx";
import "./mission-builder.css";

export function MissionDurableSummary({ flow }) {
  if (!flow?.intake_packet_ref && !flow?.latest_next_action_report_ref) return null;
  const refs = [flow.intake_packet_ref, flow.latest_next_action_report_ref].filter(Boolean);
  return <Alert tone="success" className="mission-durable-summary"><div><strong>Mission evidence is durable.</strong><span> Reload and reconnect preserve this Flow from runtime evidence.</span></div><details><summary>Evidence references · {refs.length}</summary><ul>{refs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul></details></Alert>;
}
