/**
 * CyberTrivia - Core Application Logic
 */

// Sound Synth Engine using Web Audio API
class SoundSynth {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  playOscillator(freqs, durations, type = 'sine', gainSequence = [0.1, 0]) {
    if (this.muted) return;
    this.init();
    
    // Resume context if suspended (browser security)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    try {
      const now = this.ctx.currentTime;
      let time = now;

      freqs.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);
        
        const dur = durations[idx] || 0.1;
        gainNode.gain.setValueAtTime(gainSequence[0], time);
        gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainSequence[1]), time + dur);
        
        osc.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        
        osc.start(time);
        osc.stop(time + dur);
        
        time += dur;
      });
    } catch (e) {
      console.warn("Audio playback failed", e);
    }
  }

  playTick() {
    this.playOscillator([800], [0.05], 'sine', [0.05, 0]);
  }

  playTickWarning() {
    this.playOscillator([1200], [0.1], 'triangle', [0.08, 0]);
  }

  playSuccess() {
    // C5 -> E5 -> G5 -> C6 arpeggio
    this.playOscillator([523.25, 659.25, 783.99, 1046.50], [0.08, 0.08, 0.08, 0.15], 'sine', [0.1, 0.02]);
  }

  playRoundOver() {
    // Descending buzz
    this.playOscillator([300, 150], [0.1, 0.3], 'sawtooth', [0.08, 0.001]);
  }

  playGameOver() {
    // Fanfare
    this.playOscillator([523.25, 523.25, 523.25, 659.25, 783.99, 1046.50], [0.1, 0.1, 0.1, 0.15, 0.15, 0.4], 'triangle', [0.1, 0.01]);
  }

  playJoin() {
    this.playOscillator([440, 880], [0.1, 0.15], 'sine', [0.07, 0.01]);
  }
}

const synth = new SoundSynth();

// Game State Definition
const GameState = {
  LOBBY: 'LOBBY',
  QUESTION_ACTIVE: 'QUESTION_ACTIVE',
  QUESTION_INTERMISSION: 'QUESTION_INTERMISSION',
  GAME_OVER: 'GAME_OVER'
};

// Application State
const app = {
  // Player Settings
  username: '',
  isHost: false,
  isSolo: false,
  roomId: '',
  myPeerId: '',
  
  // Game variables
  gameState: GameState.LOBBY,
  players: {}, // id -> { name, score, isHost, connected }
  currentQuestionIndex: -1,
  questions: [], // Subset of 10 questions selected for current game
  currentAnswer: '',
  currentClue: '',
  revealedIndices: new Set(),
  roundTimer: null,
  timeLeft: 50,
  
  // Correct answer trackers for points
  firstPlaceWinner: null, // peerId
  secondPlaceWinner: null, // peerId
  playersGuessedCorrectly: new Set(), // Set of peerId

  // Bot handles
  bots: [], // Array of Bot simulated objects
  botTypingTimeouts: [],
  botGuessTimeouts: [],
  nextQuestionTimeout: null, // Timeout for advancing to next question
  
  // Networking
  peer: null,
  connections: {}, // peerId -> DataConnection
  
  // DOM cache
  screens: {
    landing: null,
    game: null,
    end: null
  },
  
  // Active typers
  typingPlayers: new Set()
};

// AI Bot Simulation Class
class BotPlayer {
  constructor(id, name, accuracy, speedModifier) {
    this.id = id;
    this.name = name;
    this.accuracy = accuracy; // 0.0 to 1.0
    this.speedModifier = speedModifier; // multiplier for delays
    this.score = 0;
    this.isHost = false;
    this.isBot = true;
  }

  scheduleAction(question, answer, revealInterval) {
    // 1. Plan typing messages
    // The bot will decide whether it will guess correctly, make a mistake first, or stay silent.
    const willSolve = Math.random() < this.accuracy;
    
    // Average delay is centered around 10-30 seconds, modified by speedModifier
    const correctGuessTime = (8 + Math.random() * 25) * this.speedModifier * 1000;
    
    // Bot might make a wrong guess first
    const willMakeWrongGuess = Math.random() < 0.6;
    if (willMakeWrongGuess) {
      const wrongGuessTime = (3 + Math.random() * 8) * this.speedModifier * 1000;
      if (wrongGuessTime < correctGuessTime || !willSolve) {
        this.queueGuess(wrongGuessTime, this.generateWrongGuess(question), false);
      }
    }

    if (willSolve) {
      this.queueGuess(correctGuessTime, answer, true);
    }
  }

  queueGuess(delayMs, text, isCorrect) {
    // Simulate typing first
    const typingDelay = Math.max(1000, delayMs - 2000);
    const typingTimeout = setTimeout(() => {
      if (app.gameState !== GameState.QUESTION_ACTIVE) return;
      triggerBotTyping(this.id, true);
      
      const sendTimeout = setTimeout(() => {
        triggerBotTyping(this.id, false);
        if (app.gameState !== GameState.QUESTION_ACTIVE) return;
        
        // Submit guess
        handleChatMessage(this.id, text);
      }, delayMs - typingDelay);
      
      app.botGuessTimeouts.push(sendTimeout);
    }, typingDelay);

    app.botTypingTimeouts.push(typingTimeout);
  }

  generateWrongGuess(question) {
    const wrongAnswers = [
      "i think it's that", "maybe Jupiter?", "no clue tbh", "what is it??",
      "Paris?", "1999?", "is it water?", "hmmm...", "wait let me think",
      "idk", "London?", "rome", "yellow", "blue", "football"
    ];
    return wrongAnswers[Math.floor(Math.random() * wrongAnswers.length)];
  }
}

// Initialize application DOM bindings
document.addEventListener("DOMContentLoaded", () => {
  // Screens
  app.screens.landing = document.getElementById("landing-screen");
  app.screens.game = document.getElementById("game-screen");
  app.screens.end = document.getElementById("end-screen");

  // Check URL parameters for Room ID
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoomId = urlParams.get('room');
  if (urlRoomId) {
    app.roomId = urlRoomId;
    document.getElementById("btn-join").classList.remove("hidden");
    document.getElementById("btn-host").innerHTML = "Create New Room Instead";
    document.getElementById("btn-host").classList.remove("btn-cyan");
    document.getElementById("btn-host").classList.add("btn-outline");
  }

  // Button Event Listeners
  document.getElementById("btn-host").addEventListener("click", () => setupMode(true, false));
  document.getElementById("btn-join").addEventListener("click", () => setupMode(false, false));
  document.getElementById("btn-solo").addEventListener("click", () => setupMode(true, true));
  document.getElementById("btn-copy-link").addEventListener("click", copyRoomLink);
  document.getElementById("btn-lobby-start").addEventListener("click", triggerGameStart);
  document.getElementById("btn-play-again").addEventListener("click", resetToLobby);
  document.getElementById("btn-end-game").addEventListener("click", () => {
    if (app.isHost && (app.gameState === GameState.QUESTION_ACTIVE || app.gameState === GameState.QUESTION_INTERMISSION)) {
      addSystemMessage("QuizMaster: Game ended immediately by the host.", 'announcement');
      if (!app.isSolo) {
        broadcast({
          type: 'system_message',
          text: "QuizMaster: Game ended immediately by the host.",
          cssClass: 'announcement'
        });
      }
      endGame();
    }
  });
  
  // Chat form submit
  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitChat();
  });

  // Sound toggle elements
  const soundToggleBtn = document.getElementById("sound-toggle");
  const mobileSoundToggleBtn = document.getElementById("mobile-sound-toggle");
  
  const handleSoundToggle = () => {
    const isMuted = synth.toggleMute();
    const icon = isMuted ? "🔇" : "🔊";
    soundToggleBtn.innerText = icon;
    mobileSoundToggleBtn.innerText = icon;
    
    // Alert feedback
    addSystemMessage(isMuted ? "Sound muted" : "Sound enabled");
  };

  soundToggleBtn.addEventListener("click", handleSoundToggle);
  mobileSoundToggleBtn.addEventListener("click", handleSoundToggle);

  // Sidebar Toggles on Mobile
  const mobileSidebarToggle = document.getElementById("mobile-sidebar-toggle");
  const sidebarEl = document.getElementById("game-sidebar");
  
  mobileSidebarToggle.addEventListener("click", () => {
    sidebarEl.classList.toggle("open");
  });

  // Close sidebar on option selection (for category or copy link clicks)
  document.getElementById("category-selector").addEventListener("change", (e) => {
    if (app.isHost) {
      changeCategory(e.target.value);
    }
  });

  // Shortcut command helper
  document.getElementById("start-code-cmd").addEventListener("click", () => {
    if (app.isHost && app.gameState === GameState.LOBBY) {
      triggerGameStart();
    }
  });
});

// Setup Game Mode: Host, Join or Solo
function setupMode(isHost, isSolo) {
  const usernameInput = document.getElementById("username-input");
  if (!usernameInput.checkValidity()) {
    usernameInput.reportValidity();
    return;
  }
  
  app.username = usernameInput.value.trim();
  app.isHost = isHost;
  app.isSolo = isSolo;
  
  // Transition screens
  app.screens.landing.classList.add("hidden");
  app.screens.game.classList.remove("hidden");
  
  // Render current user immediately
  const selfId = isSolo ? 'player_host' : 'connecting';
  app.myPeerId = selfId;
  app.players[selfId] = {
    name: app.username,
    score: 0,
    isHost: isHost,
    connected: true
  };
  
  updateLeaderboard();
  
  if (isSolo) {
    setupSoloMode();
  } else if (isHost) {
    setupHostNetwork();
  } else {
    setupClientNetwork();
  }
}

// Setup Solo offline mode with bots
function setupSoloMode() {
  app.isSolo = true;
  app.isHost = true;
  
  // Hide connection UI info in sidebar
  document.getElementById("room-info-section").style.display = "none";
  document.getElementById("room-status-badge").innerText = "● Solo";
  
  addSystemMessage("Entered Solo Mode! 🤖");
  addSystemMessage("AI players are joining the room...");
  
  // Create bots
  app.bots = [
    new BotPlayer('bot_ada', 'AI_Ada', 0.65, 0.9),      // Clever, average speed
    new BotPlayer('bot_turing', 'AI_Turing', 0.85, 0.6), // Super fast, genius
    new BotPlayer('bot_curie', 'AI_Curie', 0.45, 1.3)   // Slower, casual
  ];

  setTimeout(() => {
    app.bots.forEach(bot => {
      app.players[bot.id] = {
        name: bot.name,
        score: bot.score,
        isHost: false,
        connected: true,
        isBot: true
      };
      addSystemMessage(`${bot.name} has joined the chat.`);
      synth.playJoin();
    });
    updateLeaderboard();
  }, 1000);

  // Show Start button prompt
  document.getElementById("game-start-prompt").classList.remove("hidden");
  document.getElementById("category-selector").disabled = false;
}

// NETWORK: Setup Host PeerJS Connection
function setupHostNetwork() {
  addSystemMessage("Initializing WebRTC host service...");
  document.getElementById("room-status-badge").innerText = "● Hosting";
  document.getElementById("room-status-badge").style.color = "var(--accent-cyan)";
  document.getElementById("category-selector").disabled = false;
  
  // Initialize PeerJS
  app.peer = new Peer();
  
  app.peer.on('open', (id) => {
    app.myPeerId = id;
    app.roomId = id;
    
    // Replace temporary self ID with actual Peer ID
    app.players[id] = app.players['connecting'];
    delete app.players['connecting'];
    
    document.getElementById("room-id-display").innerText = id;
    
    // Create Share Link
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${id}`;
    document.getElementById("room-link-input").value = shareUrl;
    
    addSystemMessage(`Room created! Tell friends to join using code: ${id}`);
    updateLeaderboard();
    synth.playJoin();
  });

  app.peer.on('connection', (conn) => {
    addSystemMessage("Someone is connecting...");
    
    conn.on('open', () => {
      app.connections[conn.peer] = conn;
      
      // Send current state and settings to connection
      conn.send({
        type: 'welcome',
        roomSettings: {
          category: document.getElementById("category-selector").value
        }
      });
    });

    conn.on('data', (data) => {
      handleIncomingNetworkData(conn.peer, data);
    });

    conn.on('close', () => {
      handlePlayerDisconnect(conn.peer);
    });
    
    conn.on('error', (err) => {
      console.error("Connection error:", err);
      handlePlayerDisconnect(conn.peer);
    });
  });

  app.peer.on('error', (err) => {
    console.error("PeerJS Host Error:", err);
    addSystemMessage(`Error: ${err.type || 'Connection failed'}`);
  });
}

// NETWORK: Setup Client PeerJS Connection
function setupClientNetwork() {
  addSystemMessage("Connecting to host...");
  document.getElementById("room-status-badge").innerText = "● Joining";
  document.getElementById("room-status-badge").style.color = "var(--accent-magenta)";
  document.getElementById("category-selector").disabled = true; // only host can edit
  
  // Hide host control buttons
  document.getElementById("game-start-prompt").classList.add("hidden");
  
  app.peer = new Peer();
  
  app.peer.on('open', (id) => {
    app.myPeerId = id;
    
    // Establish connection to host
    const conn = app.peer.connect(app.roomId);
    app.connections[app.roomId] = conn;
    
    conn.on('open', () => {
      // Register our profile with host
      conn.send({
        type: 'join',
        username: app.username
      });
    });

    conn.on('data', (data) => {
      handleIncomingNetworkData(app.roomId, data);
    });

    conn.on('close', () => {
      addSystemMessage("Host disconnected. Game ended.");
      setTimeout(() => {
        window.location.href = window.location.pathname; // Reload back to landing page
      }, 3000);
    });
    
    conn.on('error', (err) => {
      console.error("Client link error:", err);
    });
  });

  app.peer.on('error', (err) => {
    console.error("PeerJS Client Error:", err);
    addSystemMessage("Failed to connect to room. Redirecting to lobby...");
    setTimeout(() => {
      window.location.href = window.location.pathname;
    }, 3000);
  });
}

// Broadcast message from Host to all connected clients
function broadcast(payload) {
  Object.values(app.connections).forEach(conn => {
    if (conn.open) {
      conn.send(payload);
    }
  });
}

// Handle Incoming Network Events
function handleIncomingNetworkData(senderPeerId, data) {
  if (app.isHost) {
    // HOST HANDLERS
    switch (data.type) {
      case 'join':
        // Check if name is taken
        let requestedName = data.username.trim();
        let finalName = requestedName;
        let suffix = 1;
        const existingNames = Object.values(app.players).map(p => p.name.toLowerCase());
        while (existingNames.includes(finalName.toLowerCase())) {
          finalName = `${requestedName}_${suffix++}`;
        }

        // Register client
        app.players[senderPeerId] = {
          name: finalName,
          score: 0,
          isHost: false,
          connected: true
        };
        
        // Notify sender of success
        app.connections[senderPeerId].send({
          type: 'join_success',
          peerId: senderPeerId,
          lobbyState: {
            players: app.players,
            gameState: app.gameState,
            category: document.getElementById("category-selector").value
          }
        });

        // Broadcast updated details to everyone
        broadcast({
          type: 'player_list',
          players: app.players
        });
        
        addSystemMessage(`${finalName} has joined the chat.`);
        synth.playJoin();
        updateLeaderboard();
        break;

      case 'chat':
        handleChatMessage(senderPeerId, data.text);
        break;

      case 'typing':
        handleTypingState(senderPeerId, data.isTyping);
        break;
    }
  } else {
    // CLIENT HANDLERS
    switch (data.type) {
      case 'welcome':
        document.getElementById("room-id-display").innerText = app.roomId;
        document.getElementById("room-link-input").value = window.location.href;
        document.getElementById("category-selector").value = data.roomSettings.category;
        break;

      case 'join_success':
        app.myPeerId = data.peerId;
        app.players = data.lobbyState.players;
        app.gameState = data.lobbyState.gameState;
        document.getElementById("category-selector").value = data.lobbyState.category;
        updateLeaderboard();
        addSystemMessage("Successfully joined the lobby!");
        
        if (app.gameState !== GameState.LOBBY) {
          // Join in-progress game sync UI
          document.getElementById("game-start-prompt").classList.add("hidden");
        }
        break;

      case 'player_list':
        app.players = data.players;
        updateLeaderboard();
        break;

      case 'chat_message':
        appendChatMessage(data.senderName, data.text, data.senderId);
        break;

      case 'system_message':
        addSystemMessage(data.text, data.cssClass);
        break;

      case 'typing':
        updateTypingIndicator(data.typerId, data.typerName, data.isTyping);
        break;

      case 'sound':
        triggerSound(data.soundId);
        break;

      case 'sync_game_state':
        syncGameStateFromHost(data);
        break;
    }
  }
}

// Client State Synchronization
function syncGameStateFromHost(data) {
  app.gameState = data.gameState;
  app.currentQuestionIndex = data.questionIndex;
  app.timeLeft = data.timeLeft;
  app.currentClue = data.clue;
  
  // Update header text
  document.getElementById("question-tracker").innerText = data.questionIndex >= 0 ? `Question ${data.questionIndex + 1} of 10` : "Round 0 of 10";
  document.getElementById("question-display").innerText = data.questionText;
  document.getElementById("clue-display").innerText = data.clue.toUpperCase();
  document.getElementById("category-selector").value = data.category;
  
  // Timer circular update
  updateTimerUI(data.timeLeft);
  
  // Handle layout visibilities
  document.getElementById("game-start-prompt").classList.add("hidden");

  if (app.gameState === GameState.GAME_OVER) {
    // Game ended - keep chat visible with final scores
    // No splash screen needed
  } else if (app.gameState === GameState.QUESTION_INTERMISSION) {
    // Round concluded, show intermission hint reveal
    document.getElementById("clue-display").innerText = data.correctAnswer.toUpperCase();
  } else if (app.gameState === GameState.LOBBY) {
    // Transition back to lobby from Game Over
    app.screens.end.classList.add("hidden");
    app.screens.game.classList.remove("hidden");
    
    // Clear chat logs and setup initial view
    const chatMessages = document.getElementById("chat-messages");
    chatMessages.innerHTML = '';
    chatMessages.appendChild(document.getElementById("game-start-prompt"));
    
    // Reset players scores to 0 locally
    Object.keys(app.players).forEach(pid => {
      app.players[pid].score = 0;
    });
    updateLeaderboard();
  }
  
  updateEndGameButtonVisibility();
}

// Update Host-only End Game button visibility
function updateEndGameButtonVisibility() {
  const endBtn = document.getElementById("btn-end-game");
  if (!endBtn) return;
  if (app.isHost && (app.gameState === GameState.QUESTION_ACTIVE || app.gameState === GameState.QUESTION_INTERMISSION)) {
    endBtn.classList.remove("hidden");
  } else {
    endBtn.classList.add("hidden");
  }
}

// Player Disconnect Handler
function handlePlayerDisconnect(peerId) {
  if (app.players[peerId]) {
    const name = app.players[peerId].name;
    delete app.players[peerId];
    delete app.connections[peerId];
    addSystemMessage(`${name} left the game.`);
    updateLeaderboard();
    
    if (app.isHost) {
      broadcast({
        type: 'player_list',
        players: app.players
      });
    }
  }
}

// Copy URL link to clipboard
function copyRoomLink() {
  const linkBox = document.getElementById("room-link-input");
  linkBox.select();
  linkBox.setSelectionRange(0, 99999);
  
  navigator.clipboard.writeText(linkBox.value)
    .then(() => {
      const copyBtn = document.getElementById("btn-copy-link");
      copyBtn.innerText = "Copied!";
      copyBtn.style.background = "var(--accent-green)";
      setTimeout(() => {
        copyBtn.innerText = "Copy";
        copyBtn.style.background = "";
      }, 2000);
    })
    .catch(err => {
      console.error("Clipboard copy failed", err);
    });
}

// Change Category (Host Authoritative)
function changeCategory(category) {
  if (!app.isHost || app.gameState !== GameState.LOBBY) return;
  
  addSystemMessage(`Trivia category changed to: ${category}`, 'announcement');
  if (!app.isSolo) {
    broadcast({
      type: 'system_message',
      text: `Trivia category changed to: ${category}`,
      cssClass: 'announcement'
    });
  }
}

// Trigger Game Start (From UI or /start command)
function triggerGameStart() {
  if (!app.isHost || (app.gameState !== GameState.LOBBY && app.gameState !== GameState.GAME_OVER)) return;
  
  // Close mobile sidebar if open
  document.getElementById("game-sidebar").classList.remove("open");
  
  // Pick questions
  const selectedCategory = document.getElementById("category-selector").value;
  let filteredQuestions = TRIVIA_QUESTIONS;
  
  if (selectedCategory !== "Random") {
    filteredQuestions = TRIVIA_QUESTIONS.filter(q => q.category === selectedCategory);
  }
  
  // Shuffle and pick 10
  const shuffled = [...filteredQuestions].sort(() => 0.5 - Math.random());
  app.questions = shuffled.slice(0, 10);
  
  // Reset all players scores to 0
  Object.keys(app.players).forEach(pid => {
    app.players[pid].score = 0;
  });
  updateLeaderboard();
  
  if (!app.isSolo) {
    broadcast({
      type: 'player_list',
      players: app.players
    });
  }
  
  // Hide Lobby Prompt
  document.getElementById("game-start-prompt").classList.add("hidden");
  document.getElementById("category-selector").disabled = true;
  
  app.currentQuestionIndex = -1;
  addSystemMessage("Get ready! The Trivia Game is starting now...", 'announcement');
  
  if (!app.isSolo) {
    broadcast({
      type: 'system_message',
      text: "Get ready! The Trivia Game is starting now...",
      cssClass: 'announcement'
    });
  }
  
  triggerSoundDirectly('start');

  setTimeout(() => {
    nextQuestion();
  }, 2000);
}

// Reset Game Back to Lobby
function resetToLobby() {
  app.screens.end.classList.add("hidden");
  app.screens.game.classList.remove("hidden");

  app.gameState = GameState.LOBBY;
  app.currentQuestionIndex = -1;

  // Clear any pending timers
  if (app.roundTimer) clearInterval(app.roundTimer);
  if (app.nextQuestionTimeout) clearTimeout(app.nextQuestionTimeout);
  clearBotTimeouts();

  // Clear chat
  const chatMessages = document.getElementById("chat-messages");
  chatMessages.innerHTML = '';

  // Re-append Lobby start prompt
  chatMessages.appendChild(document.getElementById("game-start-prompt"));
  if (app.isHost) {
    document.getElementById("game-start-prompt").classList.remove("hidden");
    document.getElementById("category-selector").disabled = false;
  } else {
    document.getElementById("game-start-prompt").classList.add("hidden");
  }

  // Reset players scores to 0
  Object.keys(app.players).forEach(pid => {
    app.players[pid].score = 0;
  });
  updateLeaderboard();

  // Reset headers
  document.getElementById("question-tracker").innerText = "Round 0 of 10";
  document.getElementById("question-display").innerText = "Waiting for game to start...";
  document.getElementById("clue-display").innerText = "--------";

  // Reset timer UI
  updateTimerUI(50);

  if (app.isHost && !app.isSolo) {
    broadcast({
      type: 'player_list',
      players: app.players
    });

    broadcast({
      type: 'sync_game_state',
      gameState: app.gameState,
      questionIndex: -1,
      questionText: 'Waiting for game to start...',
      category: document.getElementById("category-selector").value,
      timeLeft: 50,
      clue: '--------',
      correctAnswer: ''
    });
  }

  updateEndGameButtonVisibility();
}

// GAMEPLAY: Prepare and transition to Next Question
function nextQuestion() {
  if (!app.isHost) return;
  
  app.currentQuestionIndex++;
  if (app.currentQuestionIndex >= 10) {
    endGame();
    return;
  }
  
  // Prepare Question State
  const qData = app.questions[app.currentQuestionIndex];
  app.gameState = GameState.QUESTION_ACTIVE;
  app.currentAnswer = qData.answer;
  app.timeLeft = 50;
  
  // Format mask clue: replace letters/numbers with underscores, keep spaces/punctuation
  app.currentClue = qData.answer.split('').map(char => {
    if (/[a-zA-Z0-9]/.test(char)) return '_';
    return char;
  }).join('');
  
  app.revealedIndices.clear();
  app.firstPlaceWinner = null;
  app.secondPlaceWinner = null;
  app.playersGuessedCorrectly.clear();
  
  // Clear any active typing/guess timeouts
  clearBotTimeouts();

  // Send state update
  syncAllClients();
  
  // Render host side
  document.getElementById("question-tracker").innerText = `Question ${app.currentQuestionIndex + 1} of 10`;
  document.getElementById("question-display").innerText = qData.question;
  document.getElementById("clue-display").innerText = app.currentClue.toUpperCase();

  addSystemMessage(`[${qData.category}] Question ${app.currentQuestionIndex + 1}: ${qData.question}`, 'announcement');

  if (!app.isSolo) {
    broadcast({
      type: 'system_message',
      text: `[${qData.category}] Question ${app.currentQuestionIndex + 1}: ${qData.question}`,
      cssClass: 'announcement'
    });
  }
  
  // Start countdown & reveal timers
  startRoundTimer();
  scheduleLetterReveals(qData.answer);
  
  // AI Bots Schedule guesses
  if (app.isSolo) {
    app.bots.forEach(bot => {
      bot.scheduleAction(qData.question, qData.answer);
    });
  }
  
  updateEndGameButtonVisibility();
}

// Schedule letter by letter reveals during 50s round
function scheduleLetterReveals(answer) {
  // Letters we can reveal: alphanumeric characters
  const revealableIndices = [];
  for (let i = 0; i < answer.length; i++) {
    if (/[a-zA-Z0-9]/.test(answer[i])) {
      revealableIndices.push(i);
    }
  }
  
  const totalLetters = revealableIndices.length;
  if (totalLetters <= 1) return; // Nothing to reveal or too short
  
  // We want to reveal up to L-1 letters.
  const lettersToReveal = totalLetters - 1;
  
  // Distribute reveals over a max 40-second window (leaving last 10s dark or solved)
  const revealIntervalMs = Math.max(3000, Math.floor(40000 / lettersToReveal));
  
  // Shuffle indices to reveal in random order
  const shuffledRevealIndices = [...revealableIndices].sort(() => 0.5 - Math.random());
  
  for (let idx = 0; idx < lettersToReveal; idx++) {
    const charIndex = shuffledRevealIndices[idx];
    const delay = (idx + 1) * revealIntervalMs;
    
    const timeout = setTimeout(() => {
      if (app.gameState !== GameState.QUESTION_ACTIVE) return;
      
      // Reveal the character
      app.revealedIndices.add(charIndex);

      // Update clue string
      app.currentClue = answer.split('').map((char, index) => {
        if (/[a-zA-Z0-9]/.test(char)) {
          return app.revealedIndices.has(index) ? char : '_';
        }
        return char;
      }).join('');

      // Update UI & Broadcast
      document.getElementById("clue-display").innerText = app.currentClue.toUpperCase();
      addSystemMessage(`💡 Hint revealed: ${app.currentClue.toUpperCase()}`, 'hint');
      if (!app.isSolo) {
        broadcast({
          type: 'system_message',
          text: `💡 Hint revealed: ${app.currentClue.toUpperCase()}`,
          cssClass: 'hint'
        });
      }
      syncAllClients();

      // Soft sound alert for reveal
      triggerSoundDirectly('tick');
    }, delay);
    
    app.botGuessTimeouts.push(timeout); // Reuse array to clear timeouts
  }
}

// Master Round Timer (Hostauthoritative)
function startRoundTimer() {
  if (app.roundTimer) clearInterval(app.roundTimer);
  
  updateTimerUI(app.timeLeft);
  
  app.roundTimer = setInterval(() => {
    app.timeLeft--;
    
    if (app.timeLeft <= 0) {
      clearInterval(app.roundTimer);
      triggerSoundDirectly('roundOver');
      revealAnswerAndEndRound();
    } else {
      if (app.timeLeft <= 10) {
        triggerSoundDirectly('tickWarning');
      } else {
        triggerSoundDirectly('tick');
      }
      
      updateTimerUI(app.timeLeft);
      syncAllClients();
    }
  }, 1000);
}

// Update Timer graphical rendering
function updateTimerUI(seconds) {
  const countdownEl = document.getElementById("timer-countdown");
  const progressCircle = document.getElementById("timer-progress");
  const timerBox = document.getElementById("timer-box");
  
  countdownEl.innerText = seconds;
  
  // SVG offset math
  // For desktop radius is 32 (circumference 201)
  // For mobile radius is 22 (circumference 138)
  const isMobile = window.innerWidth <= 768;
  const circumference = isMobile ? 138 : 201;
  const offset = circumference - (seconds / 50) * circumference;
  progressCircle.style.strokeDashoffset = offset;
  
  // Neon warning toggle
  if (seconds <= 10) {
    timerBox.classList.add("timer-warning");
  } else {
    timerBox.classList.remove("timer-warning");
  }
}

// End Question Round and transition to Intermission
function revealAnswerAndEndRound() {
  if (!app.isHost) return;
  
  clearInterval(app.roundTimer);
  app.gameState = GameState.QUESTION_INTERMISSION;
  
  // Clear bots
  clearBotTimeouts();

  // Show full answer on Hint panel
  document.getElementById("clue-display").innerText = app.currentAnswer.toUpperCase();

  addSystemMessage(`QuizMaster: Time's Up! The correct answer was "${app.currentAnswer}".`, 'announcement');
  
  syncAllClients();
  updateEndGameButtonVisibility();

  // Wait 6 seconds before loading next question
  if (app.nextQuestionTimeout) clearTimeout(app.nextQuestionTimeout);
  app.nextQuestionTimeout = setTimeout(() => {
    if (app.gameState === GameState.QUESTION_INTERMISSION) {
      nextQuestion();
    }
  }, 6000);
}

// Clean up pending Bot timers
function clearBotTimeouts() {
  app.botTypingTimeouts.forEach(clearTimeout);
  app.botGuessTimeouts.forEach(clearTimeout);
  app.botTypingTimeouts = [];
  app.botGuessTimeouts = [];
  
  // Reset typers
  app.typingPlayers.clear();
  renderTypingIndicator();
}

// Submit local user chat message
function submitChat() {
  const chatInput = document.getElementById("chat-input");
  const text = chatInput.value.trim();
  if (!text) return;
  
  chatInput.value = '';
  
  if (app.isHost) {
    handleChatMessage(app.myPeerId, text);
  } else {
    // Send to host WebRTC
    const conn = app.connections[app.roomId];
    if (conn && conn.open) {
      conn.send({
        type: 'chat',
        text: text
      });
      // Append local message optimistically? It's better to wait for host to loop back
      // so it matches strict timing, but immediate local display is nice. We will wait for host broadcast
      // to keep logs uniform across clients.
    }
  }
}

// Parse answer matching rules (Articles and Case Insensitive)
function isCorrectAnswer(guess, answer) {
  const cleanGuess = guess.trim().toLowerCase();
  const cleanAnswer = answer.trim().toLowerCase();
  
  if (cleanGuess === cleanAnswer) return true;
  
  // Strip starting articles (a, an, the)
  const stripArticles = (s) => s.replace(/^(a|an|the)\s+/i, '');
  if (stripArticles(cleanGuess) === stripArticles(cleanAnswer)) return true;
  
  return false;
}

// Authoritative Host handles chat inputs (Chat messages & Trivia guesses)
function handleChatMessage(senderId, text) {
  if (!app.isHost) return;
  
  const sender = app.players[senderId];
  if (!sender) return;
  
  const name = sender.name;
  
  // Check if starting command
  if (text.toLowerCase() === '/start') {
    if (app.gameState === GameState.LOBBY || app.gameState === GameState.GAME_OVER) {
      triggerGameStart();
    } else {
      addSystemMessage("Game is currently in progress!");
    }
    return;
  }
  
  // Check if end command
  if (text.toLowerCase() === '/end' || text.toLowerCase() === '/stop') {
    if (senderId === app.myPeerId) {
      if (app.gameState === GameState.QUESTION_ACTIVE || app.gameState === GameState.QUESTION_INTERMISSION) {
        addSystemMessage("QuizMaster: Game ended immediately by the host.", 'announcement');
        if (!app.isSolo) {
          broadcast({
            type: 'system_message',
            text: "QuizMaster: Game ended immediately by the host.",
            cssClass: 'announcement'
          });
        }
        endGame();
      } else {
        addSystemMessage("No active game to end!");
      }
    } else {
      broadcastAndAppendChat(name, text, senderId);
    }
    return;
  }
  
  // Check if answer guess
  if (app.gameState === GameState.QUESTION_ACTIVE && isCorrectAnswer(text, app.currentAnswer)) {
    // Has player already solved this round?
    if (app.playersGuessedCorrectly.has(senderId)) {
      // Allow them to type normally but don't double award points
      broadcastAndAppendChat(name, text, senderId);
      return;
    }
    
    app.playersGuessedCorrectly.add(senderId);
    
    let pointsAwarded = 0;
    let rankClass = '';
    let announcementMsg = '';
    
    if (!app.firstPlaceWinner) {
      app.firstPlaceWinner = senderId;
      pointsAwarded = 5;
      rankClass = 'correct-first';
      announcementMsg = `🏆 ${name} got it first! (+5 points)`;
      triggerSoundDirectly('success');
    } else if (!app.secondPlaceWinner) {
      app.secondPlaceWinner = senderId;
      pointsAwarded = 3;
      rankClass = 'correct-second';
      announcementMsg = `🥈 ${name} got it second! (+3 points)`;
      triggerSoundDirectly('success');
    } else {
      // Any solvers after 2nd place receive 1 fallback point or 0? 
      // The prompt states "First gets 5 and second gets 3". Let's stick strictly to 0 for 3rd+ to keep high stakes!
      announcementMsg = `✓ ${name} guessed correctly!`;
    }
    
    if (pointsAwarded > 0) {
      app.players[senderId].score += pointsAwarded;
      updateLeaderboard();
      
      // Sync leaderboard to clients
      if (!app.isSolo) {
        broadcast({
          type: 'player_list',
          players: app.players
        });
      }
    }
    
    // Add system notification
    addSystemMessage(announcementMsg, rankClass);
    if (!app.isSolo) {
      broadcast({
        type: 'system_message',
        text: announcementMsg,
        cssClass: rankClass
      });
    }

    // Check if all active players (excluding bots if solo, or all connected players) got it right
    // or if 1st and 2nd places are filled, let's keep going to let others guess. But wait, if all human players 
    // have guessed it, we can terminate early to speed things up.
    const activePlayersCount = Object.keys(app.players).length;
    if (app.playersGuessedCorrectly.size === activePlayersCount) {
      revealAnswerAndEndRound();
    }
    
  } else {
    // Standard chat message routing
    broadcastAndAppendChat(name, text, senderId);
  }
}

// Broadcast chat logs to network and append to local feed
function broadcastAndAppendChat(senderName, text, senderId) {
  appendChatMessage(senderName, text, senderId);
  if (!app.isSolo) {
    broadcast({
      type: 'chat_message',
      senderName: senderName,
      senderId: senderId,
      text: text
    });
  }
}

// Append chat balloon to screen DOM
function appendChatMessage(senderName, text, senderId) {
  const container = document.getElementById("chat-messages");
  const msgDiv = document.createElement("div");
  
  msgDiv.className = "msg";
  
  if (senderId === app.myPeerId) {
    msgDiv.classList.add("msg-self");
  } else {
    msgDiv.classList.add("msg-user");
    // Style bots with custom purple/matrix styles
    if (senderId.startsWith('bot_')) {
      msgDiv.classList.add("msg-bot");
    }
  }
  
  // Header details
  const header = document.createElement("div");
  header.className = "msg-sender";
  header.innerText = senderName;
  msgDiv.appendChild(header);
  
  // Body details
  const body = document.createElement("div");
  body.className = "msg-text";
  body.innerText = text;
  msgDiv.appendChild(body);
  
  container.appendChild(msgDiv);
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Add system/quizmaster status info to chat log
function addSystemMessage(text, cssClass = '') {
  const container = document.getElementById("chat-messages");
  const msgDiv = document.createElement("div");
  
  msgDiv.className = `msg msg-system ${cssClass}`;
  msgDiv.innerText = text;
  
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

// Sync game parameters to all WebRTC connections
function syncAllClients() {
  if (app.isSolo) return;
  
  broadcast({
    type: 'sync_game_state',
    gameState: app.gameState,
    questionIndex: app.currentQuestionIndex,
    questionText: app.questions[app.currentQuestionIndex].question,
    category: document.getElementById("category-selector").value,
    timeLeft: app.timeLeft,
    clue: app.currentClue,
    correctAnswer: app.currentAnswer,
    leaderboard: app.players
  });
}

// Leaderboard / Scoreboard updates
function updateLeaderboard() {
  const playerList = document.getElementById("player-list");
  playerList.innerHTML = '';
  
  // Sort players descending by score
  const sortedPlayers = Object.entries(app.players)
    .map(([id, info]) => ({ id, ...info }))
    .sort((a, b) => b.score - a.score);
    
  // Update player counter badge
  const totalCount = sortedPlayers.length;
  document.getElementById("players-count").innerText = `${totalCount} player${totalCount !== 1 ? 's' : ''}`;
  
  sortedPlayers.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "player-item";
    if (p.id === app.myPeerId) li.classList.add("is-self");
    if (p.isHost) li.classList.add("is-host");
    
    // Add crown styling for 1st place when points are > 0
    if (idx === 0 && p.score > 0) {
      li.classList.add("first-place");
    }
    
    // Construct HTML string
    li.innerHTML = `
      <div class="player-rank-name">
        <span class="player-crown">👑</span>
        <span class="player-name">${escapeHTML(p.name)}</span>
        ${p.isHost ? '<span style="font-size: 0.65rem; padding: 2px 5px; border-radius: 4px; background: rgba(0, 242, 254, 0.15); color: var(--accent-cyan); font-weight: bold; margin-left: 5px;">HOST</span>' : ''}
      </div>
      <div class="player-score">${p.score} pts</div>
    `;
    
    playerList.appendChild(li);
  });
}

// Escape HTML tags to prevent cross site scriptings in usernames
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Sound triggering routes
function triggerSound(soundId) {
  switch (soundId) {
    case 'tick': synth.playTick(); break;
    case 'tickWarning': synth.playTickWarning(); break;
    case 'success': synth.playSuccess(); break;
    case 'roundOver': synth.playRoundOver(); break;
    case 'gameOver': synth.playGameOver(); break;
    case 'join': synth.playJoin(); break;
  }
}

// Trigger sound and broadcast event if Host
function triggerSoundDirectly(soundId) {
  triggerSound(soundId);
  if (app.isHost && !app.isSolo) {
    broadcast({
      type: 'sound',
      soundId: soundId
    });
  }
}

// CLIENT: Typing event emitter
document.getElementById("chat-input").addEventListener("input", (e) => {
  if (app.isSolo || app.gameState !== GameState.QUESTION_ACTIVE) return;
  
  const hasText = e.target.value.trim().length > 0;
  
  if (app.isHost) {
    handleTypingState(app.myPeerId, hasText);
  } else {
    const conn = app.connections[app.roomId];
    if (conn && conn.open) {
      conn.send({
        type: 'typing',
        isTyping: hasText
      });
    }
  }
});

// Authoritative Host handles typing arrays
let typingTimeouts = {};
function handleTypingState(typerId, isTyping) {
  if (!app.isHost) return;
  
  const player = app.players[typerId];
  if (!player) return;
  
  if (isTyping) {
    app.typingPlayers.add(player.name);
    // Auto-clear typing after 3 seconds of inactivity
    if (typingTimeouts[typerId]) clearTimeout(typingTimeouts[typerId]);
    typingTimeouts[typerId] = setTimeout(() => {
      handleTypingState(typerId, false);
    }, 3000);
  } else {
    app.typingPlayers.delete(player.name);
    if (typingTimeouts[typerId]) {
      clearTimeout(typingTimeouts[typerId]);
      delete typingTimeouts[typerId];
    }
  }
  
  // Render host side typing UI
  renderTypingIndicator();
  
  // Broadcast typing array details
  if (!app.isSolo) {
    broadcast({
      type: 'typing',
      typerId: typerId,
      typerName: player.name,
      isTyping: isTyping
    });
  }
}

// Client typing tracking cache
let clientTypers = {};
function updateTypingIndicator(typerId, typerName, isTyping) {
  if (isTyping) {
    clientTypers[typerId] = typerName;
  } else {
    delete clientTypers[typerId];
  }
  
  const typingList = Object.values(clientTypers);
  const typingEl = document.getElementById("typing-indicator");
  const namesEl = document.getElementById("typing-names");
  
  if (typingList.length > 0) {
    namesEl.innerText = typingList.join(", ");
    typingEl.classList.remove("hidden");
  } else {
    typingEl.classList.add("hidden");
  }
}

// Bot typing triggers
function triggerBotTyping(botId, isTyping) {
  handleTypingState(botId, isTyping);
}

// Render typing visual bar
function renderTypingIndicator() {
  const typingEl = document.getElementById("typing-indicator");
  const namesEl = document.getElementById("typing-names");
  const typingList = Array.from(app.typingPlayers);
  
  if (typingList.length > 0) {
    namesEl.innerText = typingList.join(", ");
    typingEl.classList.remove("hidden");
  } else {
    typingEl.classList.add("hidden");
  }
}

// Game Over handler (Host Authoritative)
function endGame() {
  if (!app.isHost) return;

  app.gameState = GameState.GAME_OVER;
  clearInterval(app.roundTimer);
  if (app.nextQuestionTimeout) clearTimeout(app.nextQuestionTimeout);
  clearBotTimeouts();

  triggerSoundDirectly('gameOver');

  // Announce final scores in chat
  const sortedPlayers = Object.values(app.players)
    .sort((a, b) => b.score - a.score);

  addSystemMessage("🎮 Game Over! Final Leaderboard:", 'announcement');

  sortedPlayers.forEach((player, index) => {
    const medal = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '•';
    addSystemMessage(`${medal} ${escapeHTML(player.name)}: ${player.score} points`);
  });

  addSystemMessage("Type /start to play another round!", 'announcement');

  if (!app.isSolo) {
    broadcast({
      type: 'system_message',
      text: "🎮 Game Over! Final Leaderboard:",
      cssClass: 'announcement'
    });

    sortedPlayers.forEach((player, index) => {
      const medal = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '•';
      broadcast({
        type: 'system_message',
        text: `${medal} ${escapeHTML(player.name)}: ${player.score} points`
      });
    });

    broadcast({
      type: 'system_message',
      text: "Type /start to play another round!",
      cssClass: 'announcement'
    });
  }

  // Enable category selector so host can change it for next round
  if (app.isHost) {
    document.getElementById("category-selector").disabled = false;
  }

  syncAllClients();
  updateEndGameButtonVisibility();
}

// Display Game Over podium screen
function showEndScreen(leaderboardData) {
  app.screens.game.classList.add("hidden");
  app.screens.end.classList.remove("hidden");
  
  // Sort players list
  const sorted = Object.values(leaderboardData).sort((a, b) => b.score - a.score);
  
  // Setup Winner Announcement Text
  const winnerAnnouncement = document.getElementById("winner-announcement");
  if (sorted.length > 0 && sorted[0].score > 0) {
    winnerAnnouncement.innerHTML = `🏆 <strong>${escapeHTML(sorted[0].name)}</strong> won the game with <strong>${sorted[0].score}</strong> points!`;
    triggerConfettiEffect();
  } else {
    winnerAnnouncement.innerText = "No one scored any points! Better luck next time!";
  }
  
  // Reset Podium names/scores
  document.getElementById("podium-name-1").innerText = "-";
  document.getElementById("podium-score-1").innerText = "- pts";
  document.getElementById("podium-name-2").innerText = "-";
  document.getElementById("podium-score-2").innerText = "- pts";
  document.getElementById("podium-name-3").innerText = "-";
  document.getElementById("podium-score-3").innerText = "- pts";
  
  // Populate Podium values
  if (sorted[0]) {
    document.getElementById("podium-name-1").innerText = sorted[0].name;
    document.getElementById("podium-score-1").innerText = `${sorted[0].score} pts`;
  }
  if (sorted[1]) {
    document.getElementById("podium-name-2").innerText = sorted[1].name;
    document.getElementById("podium-score-2").innerText = `${sorted[1].score} pts`;
  }
  if (sorted[2]) {
    document.getElementById("podium-name-3").innerText = sorted[2].name;
    document.getElementById("podium-score-3").innerText = `${sorted[2].score} pts`;
  }

  // Handle display visibility of restart button (only host can trigger)
  const restartBtn = document.getElementById("btn-play-again");
  if (app.isHost) {
    restartBtn.classList.remove("hidden");
    restartBtn.innerText = "Host Play Again";
  } else {
    restartBtn.classList.add("hidden");
  }
}

// Visual Confetti Burst for Winners
function triggerConfettiEffect() {
  const container = document.body;
  const colors = ['#00f2fe', '#ff007f', '#7f00ff', '#39ff14', '#ffd700'];
  
  for (let i = 0; i < 80; i++) {
    const confetti = document.createElement("div");
    confetti.className = "confetti";
    confetti.style.left = `${Math.random() * 100}vw`;
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = `${Math.random() * 1.5}s`;
    confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
    confetti.style.transform = `scale(${0.5 + Math.random()})`;
    
    container.appendChild(confetti);
    
    // Self remove after animation finishes
    setTimeout(() => {
      confetti.remove();
    }, 4000);
  }
}
