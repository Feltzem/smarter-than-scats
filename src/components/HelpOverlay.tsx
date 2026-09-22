interface HelpOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpOverlay({ isOpen, onClose }: HelpOverlayProps) {
  if (!isOpen) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose}>
          &times;
        </button>

        <h2 style={styles.title}>How to Play</h2>

        <div style={styles.section}>
          <h3 style={styles.subtitle}>The Challenge</h3>
          <p style={styles.text}>
            You are the traffic signal engineer. Set fixed green times for each
            of the 4 signal phases at this intersection, then watch how your
            timing performs compared to what SCATS (Sydney Coordinated Adaptive
            Traffic System) actually did.
          </p>
        </div>

        <div style={styles.section}>
          <h3 style={styles.subtitle}>The 4 Phases</h3>
          <div style={styles.phaseList}>
            <div style={styles.phaseItem}>
              <span style={{ ...styles.dot, background: "#ff6b6b" }} />
              <strong>Phase A:</strong> Detectors 1|5, plus detector 2
              right-turners may filter if there is an oncoming gap
            </div>
            <div style={styles.phaseItem}>
              <span style={{ ...styles.dot, background: "#4ecdc4" }} />
              <strong>Phase B:</strong> Detectors 7|8, plus N left-turners from
              detector 1 when at front of queue
            </div>
            <div style={styles.phaseItem}>
              <span style={{ ...styles.dot, background: "#45b7d1" }} />
              <strong>Phase C:</strong> Detectors 3|7, plus detector 4
              right-turners may filter if there is an oncoming gap
            </div>
            <div style={styles.phaseItem}>
              <span style={{ ...styles.dot, background: "#ffd93d" }} />
              <strong>Phase D:</strong> Detectors 5|6, plus E left-turners from
              detector 7 when at front of queue
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <h3 style={styles.subtitle}>Detector Lanes at Stop Line</h3>
          <p style={styles.text}>
            Left lane = left/straight and right lane = right-turn only.
            Numbering by leg (left|right): North 1|2, West 3|4, South 5|6, East
            7|8.
          </p>
        </div>

        <div style={styles.section}>
          <h3 style={styles.subtitle}>Display Options</h3>
          <ul style={styles.tipList}>
            <li>
              Turn Road Arrows on in the header to show lane movement arrows on
              the road surface.
            </li>
            <li>
              Turn the CRM Inbox on to see sample customer complaints from
              vehicles that have waited a long time.
            </li>
            <li>
              Use the Light/Dark button to switch the whole display theme.
            </li>
          </ul>
        </div>

        <div style={styles.section}>
          <h3 style={styles.subtitle}>What is Delay?</h3>
          <p style={styles.text}>
            Delay is the extra time each vehicle spends compared to if it could
            drive through at free-flow speed (50 km/h) with no stops. Lower
            total delay = better signal timing. It's measured in
            vehicle-seconds.
          </p>
        </div>

        <div style={styles.section}>
          <h3 style={styles.subtitle}>Tips</h3>
          <ul style={styles.tipList}>
            <li>Give more green time to the busiest approaches</li>
            <li>
              Your timing skips phases with no stopped or queued vehicles before
              that phase starts; once a phase starts, it serves your selected
              green time.
            </li>
            <li>
              Use the "Typical Traffic Volumes (Smoothed)" chart in the left
              sidebar to guide your green-time choices — detector volumes show
              which approaches are busiest and help decide which phases need
              more green.
            </li>
            <li>
              Use the speed buttons to run the simulation faster; Reset clears
              the vehicles and returns to setup.
            </li>
            <li>Right-turn phases often need less green (fewer vehicles)</li>
            <li>
              Very short cycle lengths leave no buffer; very long cycles make
              side-street traffic wait too long
            </li>
            <li>
              CIS V3d supplies the safety transitions: 4 seconds of yellow
              followed by the phase-specific 1.5 or 2 second all-red interval.
              These timings cannot be changed here.
            </li>
            <li>
              SCATS replays the recorded day-of-operation phase pattern, so tune
              your fixed cycle to beat what actually happened.
            </li>
          </ul>
        </div>

        <div style={styles.section}>
          <h3 style={styles.subtitle}>Submitting a Score</h3>
          <p style={styles.text}>
            When the run finishes, use the Copy button beside the verification
            code in the scoreboard. Paste that full code into the spreadsheet's
            Code field so the score can be checked later.
          </p>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-color)",
    borderRadius: 16,
    padding: 30,
    maxWidth: 560,
    maxHeight: "85vh",
    overflowY: "auto" as const,
    color: "var(--text-secondary)",
    position: "relative",
    boxShadow: "0 20px 60px rgba(15,23,42,0.24)",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 16,
    background: "none",
    border: "none",
    color: "var(--text-faint)",
    fontSize: 28,
    cursor: "pointer",
    lineHeight: 1,
  },
  title: {
    margin: "0 0 20px 0",
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  section: {
    marginBottom: 20,
  },
  subtitle: {
    margin: "0 0 8px 0",
    fontSize: 15,
    fontWeight: 600,
    color: "#4a9eff",
  },
  text: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-mid)",
    margin: 0,
  },
  phaseList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  phaseItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-mid)",
    lineHeight: 1.4,
  },
  dot: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: 3,
    flexShrink: 0,
  },
  tipList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    lineHeight: 1.8,
    color: "var(--text-mid)",
  },
};
