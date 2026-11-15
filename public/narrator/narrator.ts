import { wait } from "../utils";

let lastMessage = "";
let narratorEnabled = true;

export function speak(message: string, override: boolean = false): void {
    if (!narratorEnabled && !override) return;
    
    if (!window.speechSynthesis) {
        console.warn("Speech synthesis is not supported in this browser.");
        return;
    }
    if (!message || message === lastMessage) return;

    lastMessage = message;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(message);

    window.speechSynthesis.speak(utterance);
}

// alt + n to toggle narrator
window.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "n") {
        narratorEnabled = !narratorEnabled;
        speak("Narrator " + (narratorEnabled ? "on" : "off"), true);
    }
})

let introSpoken = false;

async function speakIntro(): Promise<void> {
  if (introSpoken || !("speechSynthesis" in window)) return;

  introSpoken = true;
  speak("Press alt + n to toggle narrator");
  await wait(2800);

  speak("Welcome to Sonora, a sonification of global temperature data");
  await wait(4500);

 speak("High pitched sounds represent warmer temperatures, and low pitched sounds represent cooler temperatures");
  await wait(6000);

  speak("To get started, press p to play the scanner");
  await wait(3000);

  speak("Additionaly, press slash to search for a location");
}

// Attempt immediately, some browsers require a gester before speech can be used
speakIntro();

// Retry once a gester is detected
const unlockIntro = () => {
  window.speechSynthesis.cancel();
  speakIntro();
  if (introSpoken) {
    window.removeEventListener("pointerdown", unlockIntro);
    window.removeEventListener("keydown", unlockIntro);
  }
};
window.addEventListener("pointerdown", unlockIntro);
window.addEventListener("keydown", unlockIntro);