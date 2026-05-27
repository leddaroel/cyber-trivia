# CyberTrivia 🧠✨

A premium, chat-based real-time multiplayer trivia game built with HTML, CSS, and Vanilla JavaScript. It uses **WebRTC (via PeerJS)** for serverless peer-to-peer multiplayer, making it 100% compatible with static hosting like **GitHub Pages**!

Additionally, it contains an **Offline Solo Mode** with simulated AI Bots to play, test, and enjoy instantly without needing secondary players or active network setups.

---

## Key Features

- **🌐 Serverless Multiplayer**: Connect directly with other players via WebRTC using a generated room code/link. No backend server database required!
- **🤖 Solo Play with AI Bots**: Play offline against three distinct AI players (Ada, Turing, and Curie) with unique speed and accuracy traits.
- **👁️ Dynamic Clue Reveals**: The quizmaster reveals answers character by character over the 50-second round window, stopping when only 1 character remains.
- **🔊 Web Audio Synthesizer**: Custom procedural sounds (round wins, buzzer, ticking, fanfares) synthesized on-the-fly using the browser's Web Audio API. No external audio assets to load!
- **⏱️ Modern Visual Layouts**: Glassmorphic styling with glowing neon borders, smooth CSS transitions, responsive mobile sidebar drawers, and a circular SVG countdown progress bar.
- **🎈 Winner Podium & Confetti**: Celebrate victory at the end of 10 rounds with a custom styled podium and dynamic confetti cascades.

---

## How to Play

1. **Join the Lobby**: Enter your nickname on the landing screen.
2. **Choose Your Mode**:
   - **Create Multiplayer Room**: Generates a shareable URL (e.g. `index.html?room=PEER_ID`). Give this URL to friends!
   - **Join Multiplayer Room**: Appears automatically if someone sends you their link.
   - **Play Solo (With AI Bots)**: Starts a local session with AI bots immediately joining the chat.
3. **Control Settings (Host Only)**: The host can select a specific trivia category (General Knowledge, Science, Pop Culture, etc.) or choose "Random".
4. **Start the Game**: The host can click the **Start Game** button or type `/start` in the chat to begin.
5. **Answer Trivia**:
   - Type answers directly into the chat input.
   - Answers are checked case-insensitively and ignore leading articles (e.g., "Paris", "paris", and "the paris" all match).
   - **Scoring**: The **first** player to guess correctly gets **5 points**. The **second** player to guess correctly gets **3 points**.
   - The round ends when 50 seconds expire or all active players have guessed correctly. The game ends after 10 questions.

---

## Local Development & Testing

Since the application is fully static, you can run it using any simple local web server.

### Option 1: Python HTTP Server (Recommended)
Open your terminal inside this folder and run:
```bash
python3 -m http.server 8000
```
Then visit `http://localhost:8000` in your browser. Open a second tab or private browsing tab with the copied room link to test multiplayer side-by-side!

### Option 2: Node.js http-server
If you have Node.js installed, run:
```bash
npx http-server . -p 8000
```

---

## Deploying to GitHub Pages

Because there is no compilation step, deploying is extremely simple:

1. Create a new repository on GitHub.
2. Commit and push the files (`index.html`, `style.css`, `app.js`, `questions.js`) to your repository.
3. Go to **Settings** -> **Pages** in your repository.
4. Under **Build and deployment**, set the source to **Deploy from a branch** and select your main/master branch.
5. Save, and within a few minutes, your game will be live at `https://<your-username>.github.io/<repo-name>/`!
