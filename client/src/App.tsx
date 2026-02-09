import { useEffect, useState } from "react";
import { HelloMarble } from "./game/HelloMarble";
import { NetDebugPanel } from "./ui/NetDebugPanel";
import "./index.css";

function App() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 700px)").matches
      : false,
  );
  const [hudOpen, setHudOpen] = useState(() =>
    typeof window !== "undefined"
      ? !window.matchMedia("(max-width: 700px)").matches
      : true,
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const apply = (matches: boolean) => {
      setIsMobile(matches);
      setHudOpen(!matches);
    };

    apply(media.matches);
    const onChange = (event: MediaQueryListEvent) => {
      apply(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  const panelOpen = !isMobile || hudOpen;

  return (
    <>
      <HelloMarble panelOpen={panelOpen} />
      <NetDebugPanel panelOpen={panelOpen} />
      {isMobile ? (
        <div className="mobileMenu">
          <button
            type="button"
            onClick={() => setHudOpen((open) => !open)}
            aria-label={hudOpen ? "Close Debug Menu" : "Open Debug Menu"}
          >
            {hudOpen ? "Close" : "Menu"}
          </button>
          {!hudOpen ? <p>HUD hidden</p> : null}
        </div>
      ) : null}
    </>
  );
}

export default App;
