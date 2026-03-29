
// ======================================================================
// 1. DATA & STATE
// ======================================================================

const APP_META = {
  title: "速読英単語　必修編　マスターアプリ",
  subTitle: "01 お茶の木の種類 [文化]",
};

// State
let state = {
  viewMode: 'app', // 'app' or 'print'
  tab: 'text',     // 'text' or 'vocab'
  selectedIds: new Set(),
  voice: null,
  printSettings: null,
  isPlaying: false,
  isPaused: false,
  textData: null,
  vocabList: [],
  showMenu: false,
  expandedVocabIds: new Set(),
  // New Features State
  showHighlights: true,
  showTranslation: true,
  user: null,
  pronunciationScores: {},
  recordingState: {
    isRecording: false,
    targetId: null,
    targetType: null, // 'word' or 'sentence'
    transcript: null,
    score: null,
    feedback: null
  }
};

// Data (will be loaded from JSON)
let STORY = { en: "", jp: "" };
let VOCAB_LIST = [];
let HIGHLIGHTS = [];
let currentStoryUtterance = null;

// ======================================================================
// 2. INITIALIZATION
// ======================================================================

document.addEventListener('DOMContentLoaded', async () => {
  try {
        
    // Use window.APP_DATA instead of fetch to avoid CORS errors
    const data = window.APP_DATA;
    // [INJECTED] Update Meta
    if (data.title) APP_META.title = data.title;
    if (data.subTitle) APP_META.subTitle = data.subTitle;
    

    // Map data.json to App Structure
    STORY = {
      en: data.text.en,
      jp: data.text.ja || ""
    };

    VOCAB_LIST = data.vocabulary.map(v => ({
      id: v.id,
      word: v.word,
      meaning: v.definition,
      sentence: v.examples?.[0]?.en || null,
      translation: v.examples?.[0]?.ja || null,
      rank: "★★★" // Mock rank or derived if available
    }));

    HIGHLIGHTS = VOCAB_LIST.map(v => v.word);

    // Initial selection: All
    state.selectedIds = new Set(VOCAB_LIST.map(v => v.id));

    // Init Voice
    initVoice();

    // Init Auth Listener
    if (window.firebaseOnAuthStateChanged) {
      window.firebaseOnAuthStateChanged(async (user) => {
        setState({ user });
        if (user) {
          await loadUserData();
        } else {
          setState({ 
             selectedIds: new Set(VOCAB_LIST.map(v => v.id)),
             pronunciationScores: {} 
          });
        }
      });
    }

    // Initial Render
    render();
    lucide.createIcons();

  } catch (e) {
    console.error("Failed to load data", e);
    document.getElementById('app-root').innerHTML = `<div class="p-4 text-red-500">Error loading data: ${e.message}</div>`;
  }
});

// --- Firebase Sync Logic ---
async function loadUserData() {
  if (!state.user || !window.firebaseGetDoc) return;
  const storyId = APP_META.subTitle.split(' ')[0];
  const docRef = window.firebaseDoc(window.firebaseDb, "users", state.user.uid, "stories", `story_${storyId}`);
  try {
    const docSnap = await window.firebaseGetDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      setState({
        selectedIds: new Set(data.selectedIds || []),
        pronunciationScores: data.pronunciationScores || {}
      });
    }
  } catch (e) {
    console.error("Error loading user data", e);
  }
}

let saveTimeout = null;
function debouncedSave() {
  if (!state.user || !window.firebaseSetDoc) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    const storyId = APP_META.subTitle.split(' ')[0];
    const docRef = window.firebaseDoc(window.firebaseDb, "users", state.user.uid, "stories", `story_${storyId}`);
    try {
      await window.firebaseSetDoc(docRef, {
        selectedIds: Array.from(state.selectedIds),
        pronunciationScores: state.pronunciationScores,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.error("Error saving user data", e);
    }
  }, 1500);
}

function initVoice() {
  const setVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    // Try to find a good English voice
    const en = voices.find(v => v.name.includes('Google US English')) ||
      voices.find(v => v.lang.startsWith('en-US')) ||
      voices.find(v => v.lang.startsWith('en'));
    if (en) state.voice = en;
    render(); // Re-render whole app to update voice select safely
  };
  setVoice();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = setVoice;
  }
}

// ======================================================================
// 3. ACTIONS (State Updaters)
// ======================================================================

function setState(updates) {
  state = { ...state, ...updates };
  render();
}

function setTab(tab) {
  setState({ tab });
}

function toggleSelect(id) {
  const newSet = new Set(state.selectedIds);
  if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
  setState({ selectedIds: newSet });
  debouncedSave();
}

function toggleAll() {
  if (state.selectedIds.size === VOCAB_LIST.length) {
    setState({ selectedIds: new Set() });
  } else {
    setState({ selectedIds: new Set(VOCAB_LIST.map(v => v.id)) });
  }
  debouncedSave();
}

function toggleMenu() {
  setState({ showMenu: !state.showMenu });
}

function toggleHighlights() {
  setState({ showHighlights: !state.showHighlights });
}

function toggleTranslation() {
  setState({ showTranslation: !state.showTranslation });
}

function toggleVocabExpand(id) {
  const newSet = new Set(state.expandedVocabIds);
  if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
  setState({ expandedVocabIds: newSet });
}

function onPrintRequest(format) {
  const items = VOCAB_LIST.filter(v => state.selectedIds.has(v.id));
  if (items.length === 0) {
    alert("単語を選択してください");
    return;
  }
  setState({
    viewMode: 'print',
    printSettings: { format, items },
    showMenu: false
  });
}

function backToApp() {
  setState({ viewMode: 'app', printSettings: null });
}

function setVoice(voiceName) {
  const v = window.speechSynthesis.getVoices().find(v => v.name === voiceName);
  const wasPlayingOrPaused = state.isPlaying || state.isPaused;
  
  // Update state immediately without re-rendering everything yet to prevent losing playback focus
  state.voice = v;
  
  if (wasPlayingOrPaused) {
    // Restart playback with new voice (cancels both playing and paused states)
    window.speechSynthesis.cancel();
    setState({ isPlaying: false, isPaused: false });
    
    // Slight delay to ensure cancel completes before restarting
    setTimeout(() => {
      playStory();
    }, 50);
  } else {
    // Just re-render
    render();
  }
}

function playStory() {
  if (state.isPlaying) {
    window.speechSynthesis.pause();
    setState({ isPlaying: false, isPaused: true });
    return;
  }
  
  if (state.isPaused) {
    window.speechSynthesis.resume();
    setState({ isPlaying: true, isPaused: false });
    return;
  }

  window.speechSynthesis.cancel();
  
  // Strip circled numbers, [[HL]] tags, and word counts like "（74 words）" before reading
  const textToRead = STORY.en
    .replace(/[\u2460-\u24FF\u2776-\u277F\u3251-\u325F]/g, '')
    .replace(/\[\[\/?HL\]\]/g, '')
    .replace(/（\d+\s*words）/gi, '')
    .replace(/\(\d+\s*words\)/gi, '');
    
  currentStoryUtterance = new SpeechSynthesisUtterance(textToRead);
  if (state.voice) currentStoryUtterance.voice = state.voice;
  currentStoryUtterance.rate = 0.9;
  currentStoryUtterance.onend = () => setState({ isPlaying: false, isPaused: false });
  currentStoryUtterance.onerror = () => setState({ isPlaying: false, isPaused: false });
  
  window.speechSynthesis.speak(currentStoryUtterance);
  setState({ isPlaying: true, isPaused: false });
}

function playWord(text) {
  window.speechSynthesis.cancel();
  setState({ isPlaying: false, isPaused: false });
  const cleanText = text
    .replace(/[\u2460-\u24FF\u2776-\u277F\u3251-\u325F]/g, '')
    .replace(/\[\[\/?HL\]\]/g, '')
    .replace(/（\d+\s*words）/gi, '')
    .replace(/\(\d+\s*words\)/gi, '');
  const ut = new SpeechSynthesisUtterance(cleanText);
  if (state.voice) ut.voice = state.voice;
  window.speechSynthesis.speak(ut);
}

// --- Recording & Scoring Logic ---

function startRecording(id, type, targetText) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert("このブラウザは音声認識に対応していません。ChromeまたはEdgeをご利用ください。");
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  window.currentRecognition = recognition; // Prevent GC
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  setState({
    recordingState: {
      isRecording: true,
      targetId: id,
      targetType: type,
      transcript: null,
      score: null,
      feedback: null
    }
  });

  try {
    recognition.start();
  } catch (e) {
    console.error("Could not start recognition", e);
  }

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const confidence = event.results[0][0].confidence;
    const { score, feedback } = checkPronunciation(targetText, transcript, confidence);

    const key = `${id}_${type}`;
    const bestScore = Math.max(state.pronunciationScores[key] || 0, score);

    setState({
      recordingState: {
        isRecording: false,
        targetId: id,
        targetType: type,
        transcript: transcript,
        score: score,
        feedback: feedback
      },
      pronunciationScores: {
        ...state.pronunciationScores,
        [key]: bestScore
      }
    });
    debouncedSave();
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error", event.error);
    setState({
      recordingState: {
        isRecording: false,
        targetId: id,
        targetType: type,
        transcript: "Error: " + event.error,
        score: 0,
        feedback: "Could not hear you. Please try again."
      }
    });
  };

  recognition.onend = () => {
    if (state.recordingState.isRecording) {
      // If ended without result (e.g. silence)
      setState({
        recordingState: { ...state.recordingState, isRecording: false }
      });
    }
  };
}

function checkPronunciation(target, spoken, confidence = 0.8) {
  // Normalize: lowercase, remove punctuation
  const clean = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const t = clean(target);
  const s = clean(spoken);

  if (!s) return { score: 0, feedback: "No sound detected." };

  // Levenshtein Distance for similarity
  const distance = levenshtein(t, s);
  const maxLength = Math.max(t.length, s.length);
  const similarity = (1 - distance / maxLength) * 100;

  let score = similarity;

  // Lenient processing: significantly boost partial matches
  // E.g., a raw 60% similarity will jump to 84%
  if (score > 40) {
    score = score + (100 - score) * 0.6;
  }
  
  score = Math.round(score);

  // Hard to get 100 logic:
  // Even if they spoke perfectly (t === s), usually score becomes 100.
  // We cap perfectly recognized at 95-99 based on confidence.
  if (score >= 100) {
    // Requires very high confidence and perfect match to get 100
    if (confidence > 0.95 && t === s) {
        score = 100;
    } else if (confidence > 0.85) {
        score = 99;
    } else {
        score = 98;
    }
  }

  // Ensure 100 is rare (randomly downgrade half of 100s to 99)
  if (score === 100 && Math.random() > 0.5) {
      score = 99;
  }

  let feedback = "";
  if (score === 100) feedback = "Perfect! Excellent pronunciation!";
  else if (score >= 90) feedback = "Great job! Very close.";
  else if (score >= 75) feedback = "Good effort, but check your pronunciation.";
  else feedback = "Keep practicing. Listen and try again.";

  return { score, feedback };
}

// Levenshtein Distance Helper
function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// ======================================================================
// 4. RENDERING (Components)
// ======================================================================

function render() {
  const root = document.getElementById('app-root');

  if (state.viewMode === 'print') {
    root.innerHTML = renderPrintView();
  } else {
    root.innerHTML = renderAppView();
  }

  lucide.createIcons();
}

function renderAppView() {
  return `
    <div class="min-h-screen bg-slate-50 text-slate-900 font-serif pb-20">
        ${renderHeader()}
        ${renderTabNav()}
        <main class="max-w-3xl mx-auto p-4">
            ${state.tab === 'text' ? renderTextComponent() : renderVocabComponent()}
        </main>
    </div>
    `;
}

function renderHeader() {
  // Voices options
  const voices = window.speechSynthesis.getVoices().filter(v => v.name.includes('Google') && v.lang.startsWith('en'));
  const options = voices.map(v =>
    `<option value="${v.name}" ${state.voice?.name === v.name ? 'selected' : ''} class="text-black">${v.name}</option>`
  ).join('');

  const authSection = state.user 
    ? `
      <div class="flex items-center gap-3">
        <img src="${state.user.photoURL}" alt="Profile" class="w-8 h-8 rounded-full border-2 border-white/50" referrerpolicy="no-referrer">
        <span class="text-sm font-bold truncate max-w-[100px] hidden sm:inline-block">${state.user.displayName.split(' ')[0]}</span>
        <button onclick="window.firebaseSignOut()" class="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded transition">Logout</button>
      </div>
    `
    : `
      <button onclick="window.firebaseSignIn()" class="flex items-center gap-2 bg-white text-blue-900 hover:bg-blue-50 px-4 py-2 rounded font-bold text-sm transition shadow">
        <i data-lucide="user" class="w-4 h-4"></i> Login
      </button>
    `;

  return `
    <header class="bg-blue-900 text-white p-5 shadow sticky top-0 z-20">
        <div class="max-w-4xl mx-auto flex justify-between items-center gap-4">
          <div class="flex-1">
            <h1 class="font-bold text-2xl md:text-3xl leading-tight truncate px-1">${APP_META.title}</h1>
            <p class="text-blue-200 text-lg mt-1 truncate px-1">${APP_META.subTitle}</p>
          </div>
          <div class="flex flex-col sm:flex-row items-end sm:items-center gap-3">
            ${authSection}
            <div class="bg-black/20 p-2 rounded flex items-center">
              <i data-lucide="volume-2" class="text-blue-200 mr-2 w-5 h-5"></i>
              <select class="bg-transparent text-white text-base max-w-[120px] sm:max-w-[180px]" onchange="setVoice(this.value)">
                  ${options}
              </select>
            </div>
          </div>
        </div>
    </header>
    `;
}

function renderTabNav() {
  return `
    <div class="max-w-4xl mx-auto mt-4 px-4 sticky top-24 z-10">
        <div class="flex bg-white rounded shadow border border-slate-200 overflow-hidden">
          <button onclick="setTab('text')" class="flex-1 py-4 font-bold flex justify-center items-center gap-2 text-xl ${state.tab === 'text' ? 'bg-blue-100 text-blue-900' : 'text-slate-500 hover:bg-slate-50'}">
            <i data-lucide="file-text" class="w-6 h-6"></i> Text
          </button>
          <button onclick="setTab('vocab')" class="flex-1 py-4 font-bold flex justify-center items-center gap-2 text-xl ${state.tab === 'vocab' ? 'bg-indigo-100 text-indigo-900' : 'text-slate-500 hover:bg-slate-50'}">
            <i data-lucide="book-open" class="w-6 h-6"></i> Vocab
          </button>
        </div>
    </div>
    `;
}

function renderTextComponent() {
  // Use [[HL]] tokens parsed from script rather than doing naive regex mapping
  const formatText = (textStr) => {
    if (!textStr) return "";
    
    // Split by [[HL]] and [[/HL]] markers
    // E.g. "Some text [[HL]]highlighted[[/HL]] more text"
    
    // We use a regex approach to iterate over matches
    const parts = textStr.split(/(\[\[\/?HL\]\])/g);
    let output = "";
    let isHighlighted = false;
    
    for (const part of parts) {
      if (part === "[[HL]]") {
        isHighlighted = true;
      } else if (part === "[[/HL]]") {
        isHighlighted = false;
      } else {
        if (isHighlighted) {
           if (state.showHighlights) {
             output += `<span class="bg-yellow-200 text-blue-900 font-bold px-1 rounded transition-all duration-300 inline-block">${part}</span>`;
           } else {
             output += `<span class="bg-slate-300 text-transparent font-bold px-1 rounded select-none cursor-pointer transition-all duration-300 inline-block" onclick="toggleHighlights()">${part}</span>`;
           }
        } else {
           output += part;
        }
      }
    }
    return output;
  };
  
  const formattedEn = STORY.en.split('\n').map(p => formatText(p)).join('<br><br>');
  const formattedJp = STORY.jp.split('\n').map(p => formatText(p)).join('<br><br>');

  return `
    <div class="space-y-6">
      
      <!-- Text Controls -->
      <div class="flex flex-wrap gap-4 mb-2">
        <button onclick="toggleHighlights()" class="px-4 py-2 rounded-full text-sm font-bold border transition-colors flex items-center gap-2 ${state.showHighlights ? 'bg-yellow-100 border-yellow-300 text-yellow-800' : 'bg-slate-100 border-slate-300 text-slate-500'}">
          <i data-lucide="${state.showHighlights ? 'eye' : 'eye-off'}" class="w-4 h-4"></i>
          Vocab: ${state.showHighlights ? 'Visible' : 'Hidden'}
        </button>
        <button onclick="toggleTranslation()" class="px-4 py-2 rounded-full text-sm font-bold border transition-colors flex items-center gap-2 ${state.showTranslation ? 'bg-blue-100 border-blue-300 text-blue-800' : 'bg-white border-slate-300 text-slate-500'}">
          <i data-lucide="${state.showTranslation ? 'languages' : 'minus'}" class="w-4 h-4"></i>
          Original/Translation
        </button>
      </div>

      <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-800">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-blue-900">ENGLISH STORY</h2>
          <button onclick="playStory()" class="px-5 py-2 rounded-full text-base font-bold shadow flex items-center gap-2 ${state.isPlaying ? 'bg-rose-500 text-white' : 'bg-blue-600 text-white'}">
            <i data-lucide="${state.isPlaying ? 'pause' : 'play'}" class="w-5 h-5"></i> ${state.isPlaying ? 'Stop' : (state.isPaused ? 'Resume' : 'Listen')}
          </button>
        </div>
        <p class="text-2xl leading-loose text-left text-slate-800 font-serif tracking-wide">
          ${formattedEn}
        </p>
      </div>

      ${state.showTranslation ? `
      <div class="bg-slate-100 p-6 rounded-lg border-l-4 border-slate-400 animate-in fade-in slide-in-from-top-4 duration-300">
        <h2 class="text-lg font-bold text-slate-600 mb-3">日本語訳</h2>
        <p class="leading-loose text-slate-700 text-lg">${formattedJp}</p>
      </div>
      ` : ''}
    </div>
  `;
}

function renderVocabComponent() {
  const isAllSelected = state.selectedIds.size === VOCAB_LIST.length;

  // Menu Item Helper
  const menuItem = (id, label, icon) => `
        <button onclick="onPrintRequest('${id}')" class="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center gap-3 border-b last:border-0 text-slate-700 text-sm">
            <span class="text-blue-500"><i data-lucide="${icon}" class="w-4 h-4"></i></span> ${label}
        </button>
    `;

  return `
    <div class="space-y-4">
        <!-- Toolbar -->
        <div class="bg-blue-50 border border-blue-200 p-6 rounded flex justify-between items-center sticky top-44 z-10 shadow-sm">
            <button onclick="toggleAll()" class="flex items-center gap-3 font-bold text-slate-700 text-xl">
                <i data-lucide="${isAllSelected ? 'check-square' : 'square'}" class="${isAllSelected ? 'text-blue-600' : ''} w-8 h-8"></i>
                全選択 (${state.selectedIds.size})
            </button>
            
            <div class="relative">
                <button onclick="toggleMenu()" class="bg-blue-700 text-white px-6 py-3 rounded shadow font-bold text-base flex items-center gap-2 hover:bg-blue-800">
                  <i data-lucide="printer" class="w-6 h-6"></i> プリント作成
                </button>
                ${state.showMenu ? `
                  <div class="absolute right-0 top-full mt-3 w-72 bg-white rounded shadow-xl border border-slate-200 z-30 animate-in fade-in zoom-in duration-200">
                    <div class="bg-slate-100 p-4 text-base font-bold text-slate-500 border-b">形式を選択</div>
                    ${menuItem('list', '暗記リスト', 'list')}
                    ${menuItem('test-meaning', '意味テスト', 'file-question')}
                    ${menuItem('test-spelling', 'スペルテスト', 'file-question')}
                    ${menuItem('test-example', '例文テスト', 'file-text')}
                    ${menuItem('cards', '単語カード', 'grid')}
                    ${menuItem('foldable', '折りたたみ', 'scissors')}
                  </div>
                ` : ''}
            </div>
        </div>

        <!-- List -->
        <div class="space-y-3">
            ${VOCAB_LIST.map(item => renderVocabCard(item)).join('')}
        </div>
    </div>
    `;
}

function renderVocabCard(item) {
  const isSelected = state.selectedIds.has(item.id);

  return `
    <div class="bg-white rounded-lg shadow border transition-colors ${isSelected ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200'}">
      <div class="flex">
        <div onclick="toggleSelect('${item.id}')" class="w-16 flex items-center justify-center cursor-pointer border-r border-slate-100 hover:bg-slate-50">
          <i data-lucide="${isSelected ? 'check-square' : 'square'}" class="${isSelected ? 'text-blue-600' : 'text-slate-300'} w-8 h-8"></i>
        </div>
        <div class="flex-1 p-5">
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
              <span class="bg-blue-100 text-blue-800 text-base font-bold w-12 h-8 flex items-center justify-center rounded flex-shrink-0">${item.id}</span>
              <h3 class="text-2xl font-bold ${isSelected ? 'text-slate-900' : 'text-slate-500'}">${item.word}</h3>
              <button onclick="playWord('${item.word}')" class="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-blue-500">
                <i data-lucide="volume-2" class="w-6 h-6"></i>
              </button>
            </div>
          </div>
          <p class="text-xl text-slate-700 mt-2 break-words whitespace-pre-wrap">${item.meaning}</p>
          ${item.sentence ? `
            <div class="mt-4 pt-4 border-t border-slate-100">
              <div class="flex items-center gap-3 mb-2">
                <span class="text-xs bg-slate-200 px-2 py-1 rounded font-bold text-slate-600">EX</span>
                <button onclick="playWord('${item.sentence.replace(/'/g, "\\'")}')" class="text-sm flex items-center gap-2 border px-3 py-1 rounded bg-white hover:bg-slate-50 font-bold transition-colors">
                    <i data-lucide="play" class="w-4 h-4"></i> Listen
                </button>
              </div>
              <p class="text-xl leading-relaxed text-slate-800">${item.sentence}</p>
              <p class="text-lg text-slate-500 mt-1">${item.translation}</p>
            </div>
          ` : ''}
          
           <!-- Recording Section -->
           <div class="mt-4 pt-4 border-t border-slate-200">
             <div class="flex flex-col gap-3">
               <!-- Word Recording -->
               <div class="flex items-center justify-between bg-white p-3 rounded border border-slate-200 shadow-sm">
                 <span class="font-bold text-slate-600 text-sm">Pronunciation</span>
                 ${renderRecorder(item.id, 'word', item.word)}
               </div>

               <!-- Sentence Recording (if exists) -->
               ${item.sentence ? `
               <div class="flex items-center justify-between bg-white p-3 rounded border border-slate-200 shadow-sm">
                 <span class="font-bold text-slate-600 text-sm">Sentence</span>
                 ${renderRecorder(item.id, 'sentence', item.sentence)}
               </div>
               ` : ''}
             </div>
           </div>

        </div>
      </div>
    </div>
    `;
}

function renderRecorder(id, type, targetText) {
  const isCurrent = String(state.recordingState.targetId) === String(id) && state.recordingState.targetType === type;
  const isRec = isCurrent && state.recordingState.isRecording;
  const score = isCurrent ? state.recordingState.score : null;
  const feedback = isCurrent ? state.recordingState.feedback : null;
  const transcript = isCurrent ? state.recordingState.transcript : '';
  const safeText = targetText.replace(/'/g, "\\'");

  if (isCurrent && isRec) {
    return `
      <button class="bg-rose-100 text-rose-600 px-4 py-2 rounded-full font-bold flex items-center gap-2 animate-pulse">
        <i data-lucide="mic" class="w-4 h-4"></i> Listening...
      </button>
    `;
  }

  if (isCurrent && score !== null) {
    const colorClass = score >= 80 ? 'text-green-600 bg-green-50 border-green-200' : 'text-orange-600 bg-orange-50 border-orange-200';
    return `
      <div class="flex items-center gap-3">
        <div class="text-right">
            <div class="text-xs text-slate-400">You said: "${transcript}"</div>
            <div class="font-bold text-sm ${score >= 80 ? 'text-green-600' : 'text-orange-500'}">${feedback}</div>
        </div>
        <div class="flex flex-col items-center justify-center w-12 h-12 rounded-full border-2 ${colorClass}">
            <span class="text-xs font-bold">SCORE</span>
            <span class="text-lg font-bold leading-none">${score}</span>
        </div>
        <button onclick="startRecording('${id}', '${type}', '${safeText}')" class="p-2 bg-slate-100 rounded-full hover:bg-slate-200">
            <i data-lucide="rotate-ccw" class="w-4 h-4 text-slate-500"></i>
        </button>
      </div>
    `;
  }

  return `
    <button onclick="startRecording('${id}', '${type}', '${safeText}')" class="bg-blue-50 text-blue-600 hover:bg-blue-100 px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2 transition-colors">
      <i data-lucide="mic" class="w-4 h-4"></i> Record
    </button>
  `;
}

function renderPrintView() {
  const { format, items } = state.printSettings;
  const date = new Date().toLocaleDateString();

  const getTitle = () => {
    switch (format) {
      case 'list': return '単語リスト';
      case 'test-meaning': return '意味テスト';
      case 'test-spelling': return 'スペルテスト';
      case 'test-example': return '例文テスト';
      case 'cards': return '単語カード';
      case 'foldable': return '折りたたみシート';
      default: return '印刷';
    }
  };

  let contentHtml = '';

  if (format === 'list') {
    contentHtml = `
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-slate-100">
                <th class="border border-black p-2 w-10 text-center">No.</th>
                <th class="border border-black p-2 w-1/3">Word</th>
                <th class="border border-black p-2">Meaning</th>
                <th class="border border-black p-2 w-12 text-center">Chk</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item, i) => `
                <tr class="avoid-break">
                  <td class="border border-black p-2 text-center">${i + 1}</td>
                  <td class="border border-black p-2 font-bold text-lg">${item.word}</td>
                  <td class="border border-black p-2">${item.meaning}</td>
                  <td class="border border-black p-2"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
  } else if (format === 'test-meaning') {
    contentHtml = `
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-slate-100">
                <th class="border border-black p-2 w-10 text-center">No.</th>
                <th class="border border-black p-2 w-1/3">Word</th>
                <th class="border border-black p-2">Meaning (日本語)</th>
                <th class="border border-black p-2 w-12 text-center">Score</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item, i) => `
                <tr class="avoid-break">
                  <td class="border border-black p-3 text-center text-slate-500">${i + 1}</td>
                  <td class="border border-black p-3 font-bold text-lg">${item.word}</td>
                  <td class="border border-black p-3"></td>
                  <td class="border border-black p-3"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
  } else if (format === 'test-spelling') {
    contentHtml = `
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-slate-100">
                <th class="border border-black p-2 w-10 text-center">No.</th>
                <th class="border border-black p-2">Meaning</th>
                <th class="border border-black p-2 w-1/3">Word (English)</th>
                <th class="border border-black p-2 w-12 text-center">Score</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item, i) => `
                <tr class="avoid-break">
                  <td class="border border-black p-3 text-center text-slate-500">${i + 1}</td>
                  <td class="border border-black p-3">${item.meaning}</td>
                  <td class="border border-black p-3 align-bottom">
                    <div class="text-right text-[10px] text-slate-400">(${item.word.length} letters)</div>
                  </td>
                  <td class="border border-black p-3"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
  } else if (format === 'test-example') {
    contentHtml = `
          <div class="space-y-6">
            ${items.map((item, i) => {
      if (!item.sentence) return '';
      const masked = item.sentence.replace(new RegExp(`\\b${item.word}\\b`, 'gi'), '_______');
      return `
                <div class="avoid-break border-b border-slate-300 pb-4">
                  <div class="flex gap-4">
                    <span class="font-bold w-6 text-center">${i + 1}.</span>
                    <div class="flex-1">
                      <p class="text-lg mb-1 leading-relaxed">
                        ${masked.includes('_______') ? masked : item.sentence.replace(item.word, '_______')}
                      </p>
                      <p class="text-xs text-slate-500">${item.translation}</p>
                    </div>
                  </div>
                  <div class="mt-2 ml-10 text-xs text-slate-400 italic">Hint: ${item.meaning}</div>
                </div>
              `;
    }).join('')}
          </div>
        `;
  } else if (format === 'cards') {
    contentHtml = `
          <div class="grid grid-cols-2 border-l border-t border-slate-300">
            ${items.map((item) => `
              <div class="avoid-break border-r border-b border-slate-300 h-40 flex flex-col items-center justify-center text-center p-4 relative">
                <span class="absolute top-2 left-2 text-xs text-slate-400">No. ${item.id}</span>
                <p class="text-2xl font-bold mb-2">${item.word}</p>
                <div class="w-3/4 border-t border-dashed border-slate-300 my-2"></div>
                <p class="text-xs">${item.meaning}</p>
                <span class="absolute -top-1 -left-1 w-2 h-2 border-l border-t border-black"></span>
                <span class="absolute -top-1 -right-1 w-2 h-2 border-r border-t border-black"></span>
                <span class="absolute -bottom-1 -left-1 w-2 h-2 border-l border-b border-black"></span>
                <span class="absolute -bottom-1 -right-1 w-2 h-2 border-r border-b border-black"></span>
              </div>
            `).join('')}
          </div>
        `;
  } else if (format === 'foldable') {
    contentHtml = `
          <div class="relative">
            <p class="text-center text-xs italic mb-2 text-slate-400">--- Center Fold Line ---</p>
            <div class="grid grid-cols-2 border-2 border-black">
              ${items.map((item, i) => `
                  <div class="avoid-break p-2 border-b border-r border-black flex justify-between items-center ${i % 2 === 0 ? 'bg-slate-50' : 'bg-white'}">
                    <span class="text-xs text-slate-400">${i + 1}</span>
                    <span class="font-bold">${item.word}</span>
                  </div>
                  <div class="avoid-break p-2 border-b border-black text-xs flex items-center ${i % 2 === 0 ? 'bg-slate-50' : 'bg-white'}">
                    ${item.meaning}
                  </div>
              `).join('')}
            </div>
            <div class="absolute top-6 bottom-0 left-1/2 w-px border-l-2 border-dashed border-slate-400 transform -translate-x-1/2 pointer-events-none"></div>
          </div>
        `;
  }

  return `
    <div class="print-container bg-white font-serif text-black">
      <!-- Control Bar -->
      <div class="no-print fixed top-0 left-0 right-0 bg-slate-800 text-white p-4 flex justify-between items-center shadow z-50">
        <div class="flex items-center gap-4">
          <button onclick="backToApp()" class="flex items-center gap-2 hover:text-blue-300">
            <i data-lucide="arrow-left" class="w-4 h-4"></i> 戻る
          </button>
          <div class="h-6 w-px bg-slate-600"></div>
          <div>
            <h2 class="font-bold">${getTitle()}</h2>
            <p class="text-xs text-slate-400">${items.length}件</p>
          </div>
        </div>
        <button onclick="window.print()" class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded font-bold shadow flex items-center gap-2">
          <i data-lucide="printer" class="w-4 h-4"></i> 印刷する
        </button>
      </div>

      <!-- Spacer -->
      <div class="h-24 no-print"></div>

      <!-- Paper -->
      <div class="paper">
        <header class="border-b-2 border-black pb-2 mb-6 flex justify-between items-end avoid-break">
          <div>
            <h1 class="text-xl font-bold">${APP_META.title}</h1>
            <p class="text-sm">${APP_META.subTitle} - ${getTitle()}</p>
          </div>
          <div class="text-right text-sm">
            <p>Date: ${date}</p>
            <div class="mt-4 border-b border-black w-32"></div>
            <p class="text-xs">Name</p>
          </div>
        </header>

        ${contentHtml}
      </div>
    </div>
    `;
}
