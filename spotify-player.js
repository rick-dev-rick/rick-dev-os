(function () {
  "use strict";

  const redirectUri = "https://rick-dev-rick.github.io/rick-dev-os/";
  const clientIdKey = "rick-dev-spotify-client-id";
  const tokenKey = "rick-dev-spotify-token";
  const verifierKey = "rick-dev-spotify-code-verifier";
  const stateKey = "rick-dev-spotify-oauth-state";
  const scopes = "user-read-playback-state user-modify-playback-state";

  const widget = document.querySelector("#spotify-widget");
  if (!widget) return;

  const appShell = document.querySelector("#app-shell");
  const panel = document.querySelector("#spotify-widget-panel");
  const panelToggle = document.querySelector("#spotify-widget-toggle");
  const status = document.querySelector("#spotify-status");
  const trackTitle = document.querySelector("#spotify-track-title");
  const trackArtist = document.querySelector("#spotify-track-artist");
  const previousButton = document.querySelector("#spotify-previous");
  const playButton = document.querySelector("#spotify-play-toggle");
  const nextButton = document.querySelector("#spotify-next");
  const connectButton = document.querySelector("#spotify-connect");
  const disconnectButton = document.querySelector("#spotify-disconnect");
  const settingsToggle = document.querySelector("#spotify-settings-toggle");
  const settingsForm = document.querySelector("#spotify-settings");
  const clientIdInput = document.querySelector("#spotify-client-id");

  let clientId = localStorage.getItem(clientIdKey) || "";
  let token = null;
  let playback = null;
  let refreshTimer = null;

  function readStoredToken() {
    try {
      return JSON.parse(localStorage.getItem(tokenKey) || "null");
    } catch (_) {
      return null;
    }
  }

  function writeStatus(message) {
    status.textContent = message;
  }

  function showTrack(state) {
    playback = state;
    const item = state && state.item;
    if (!item) {
      trackTitle.textContent = "Nenhuma música ativa";
      trackArtist.textContent = "Abra o Spotify e comece a tocar";
      playButton.textContent = "▶";
      playButton.setAttribute("aria-label", "Reproduzir");
      previousButton.disabled = true;
      playButton.disabled = true;
      nextButton.disabled = true;
      return;
    }

    trackTitle.textContent = item.name || "Faixa do Spotify";
    trackArtist.textContent = (item.artists || []).map(function (artist) { return artist.name; }).join(", ") || "Spotify";
    const isPlaying = Boolean(state.is_playing);
    playButton.textContent = isPlaying ? "Ⅱ" : "▶";
    playButton.setAttribute("aria-label", isPlaying ? "Pausar" : "Retomar reprodução");
    previousButton.disabled = false;
    playButton.disabled = false;
    nextButton.disabled = false;
  }

  function updateConnectState() {
    const saved = readStoredToken();
    const connected = Boolean(saved && saved.refreshToken);
    connectButton.hidden = connected;
    disconnectButton.hidden = !connected;
  }

  function encodeBase64Url(bytes) {
    let binary = "";
    new Uint8Array(bytes).forEach(function (value) { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  function randomString(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, function (value) {
      return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"[value % 66];
    }).join("");
  }

  async function createCodeChallenge(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return encodeBase64Url(digest);
  }

  function cleanAuthQuery() {
    const cleanUrl = new URL(window.location.href);
    ["code", "state", "error"].forEach(function (key) { cleanUrl.searchParams.delete(key); });
    window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  }

  async function requestToken(body) {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || "O Spotify não aceitou a conexão.");
    return data;
  }

  function saveTokens(data, existingRefreshToken) {
    token = data.access_token;
    const saved = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || existingRefreshToken,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
    };
    localStorage.setItem(tokenKey, JSON.stringify(saved));
    updateConnectState();
  }

  async function completeAuthorization() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const error = params.get("error");
    if (error) {
      cleanAuthQuery();
      sessionStorage.removeItem(verifierKey);
      sessionStorage.removeItem(stateKey);
      writeStatus("A autorização do Spotify foi cancelada.");
      return;
    }
    if (!code) return;

    const expectedState = sessionStorage.getItem(stateKey);
    const verifier = sessionStorage.getItem(verifierKey);
    cleanAuthQuery();
    sessionStorage.removeItem(verifierKey);
    sessionStorage.removeItem(stateKey);
    if (!expectedState || returnedState !== expectedState || !verifier) {
      writeStatus("Não consegui validar o retorno do Spotify. Tente conectar novamente.");
      return;
    }

    try {
      writeStatus("Finalizando conexão segura com o Spotify…");
      const data = await requestToken({
        client_id: clientId,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      });
      saveTokens(data, null);
      writeStatus("Spotify conectado. Carregando sua reprodução…");
      await refreshPlayback();
    } catch (error) {
      writeStatus(error.message || "Não consegui conectar ao Spotify.");
    }
  }

  async function getAccessToken() {
    if (!clientId) throw new Error("Abra CONFIGURAR e informe o Client ID do Spotify.");
    const saved = readStoredToken();
    if (!saved || !saved.refreshToken) throw new Error("Conecte sua conta do Spotify.");
    if (saved.accessToken && saved.expiresAt > Date.now() + 60000) {
      token = saved.accessToken;
      return token;
    }

    let data;
    try {
      data = await requestToken({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: saved.refreshToken
      });
    } catch (_) {
      localStorage.removeItem(tokenKey);
      updateConnectState();
      throw new Error("Sua autorização venceu. Conecte o Spotify novamente.");
    }
    saveTokens(data, saved.refreshToken);
    return token;
  }

  async function apiRequest(path, method) {
    const accessToken = await getAccessToken();
    const response = await fetch("https://api.spotify.com/v1" + path, {
      method: method || "GET",
      headers: { Authorization: "Bearer " + accessToken }
    });
    if (response.status === 204) return null;
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = null; }
    if (!response.ok) {
      const error = new Error(body && body.error && body.error.message || "Falha ao falar com o Spotify.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function explainApiError(error) {
    if (error.status === 401) return "A conexão expirou. Desconecte e conecte o Spotify novamente.";
    if (error.status === 403) return "O Spotify não autorizou o comando. Confira se sua conta tem Premium.";
    if (error.status === 404) return "Nenhum dispositivo ativo. Abra o Spotify e inicie uma música.";
    if (error.status === 429) return "O Spotify pediu para aguardar antes de tentar de novo.";
    return error.message || "Não consegui falar com o Spotify.";
  }

  async function refreshPlayback() {
    if (!appShell || appShell.hidden || panel.hidden || !readStoredToken()) return;
    try {
      const state = await apiRequest("/me/player");
      showTrack(state);
      if (state && state.item) {
        writeStatus(state.is_playing ? "TOCANDO AGORA" : "PAUSADO");
      } else {
        writeStatus("Conectado. Abra o Spotify e comece a tocar.");
      }
    } catch (error) {
      writeStatus(explainApiError(error));
    }
  }

  async function sendPlaybackCommand(command) {
    if (!readStoredToken()) {
      writeStatus("Conecte sua conta do Spotify primeiro.");
      return;
    }
    [previousButton, playButton, nextButton].forEach(function (button) { button.disabled = true; });
    try {
      if (command === "toggle") {
        await apiRequest(playback && playback.is_playing ? "/me/player/pause" : "/me/player/play", "PUT");
      } else if (command === "previous") {
        await apiRequest("/me/player/previous", "POST");
      } else {
        await apiRequest("/me/player/next", "POST");
      }
      writeStatus("Comando enviado ao Spotify…");
      window.setTimeout(refreshPlayback, 900);
    } catch (error) {
      writeStatus(explainApiError(error));
      showTrack(playback);
    }
  }

  async function beginAuthorization() {
    clientId = localStorage.getItem(clientIdKey) || "";
    if (!clientId) {
      settingsForm.hidden = false;
      clientIdInput.focus();
      writeStatus("Configure primeiro o Client ID do seu app Spotify.");
      return;
    }
    if (!window.crypto || !crypto.subtle) {
      writeStatus("A conexão segura precisa de um navegador atualizado.");
      return;
    }

    try {
      const verifier = randomString(64);
      const state = randomString(32);
      const challenge = await createCodeChallenge(verifier);
      sessionStorage.setItem(verifierKey, verifier);
      sessionStorage.setItem(stateKey, state);
      const url = new URL("https://accounts.spotify.com/authorize");
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope: scopes,
        redirect_uri: redirectUri,
        state: state,
        code_challenge_method: "S256",
        code_challenge: challenge
      }).toString();
      window.location.assign(url.toString());
    } catch (_) {
      writeStatus("Não consegui iniciar a conexão segura com o Spotify.");
    }
  }

  function setWidgetMinimized(minimized) {
    widget.classList.toggle("is-minimized", minimized);
    panel.hidden = minimized;
    panelToggle.setAttribute("aria-expanded", String(!minimized));
    panelToggle.setAttribute("aria-label", minimized ? "Abrir controles do Spotify" : "Minimizar controles do Spotify");
    panelToggle.title = minimized ? "Abrir controles do Spotify" : "Minimizar controles do Spotify";
    localStorage.setItem("rick-dev-spotify-widget-minimized", String(minimized));
    if (minimized) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    } else {
      startPolling();
    }
  }

  const savedMinimized = localStorage.getItem("rick-dev-spotify-widget-minimized");
  setWidgetMinimized(savedMinimized !== "false");
  panelToggle.addEventListener("click", function () {
    setWidgetMinimized(!widget.classList.contains("is-minimized"));
  });

  connectButton.addEventListener("click", beginAuthorization);
  previousButton.addEventListener("click", function () { sendPlaybackCommand("previous"); });
  playButton.addEventListener("click", function () { sendPlaybackCommand("toggle"); });
  nextButton.addEventListener("click", function () { sendPlaybackCommand("next"); });

  settingsToggle.addEventListener("click", function () {
    settingsForm.hidden = !settingsForm.hidden;
    if (!settingsForm.hidden) {
      clientIdInput.value = localStorage.getItem(clientIdKey) || "";
      clientIdInput.focus();
    }
  });

  settingsForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const nextClientId = clientIdInput.value.trim();
    if (!nextClientId) return;
    if (nextClientId !== clientId) {
      localStorage.removeItem(tokenKey);
      token = null;
      playback = null;
      clientId = nextClientId;
      localStorage.setItem(clientIdKey, clientId);
      showTrack(null);
      updateConnectState();
    }
    settingsForm.hidden = true;
    writeStatus("Client ID salvo neste navegador. Agora conecte sua conta.");
    startPolling();
  });

  disconnectButton.addEventListener("click", function () {
    localStorage.removeItem(tokenKey);
    token = null;
    playback = null;
    window.clearInterval(refreshTimer);
    refreshTimer = null;
    showTrack(null);
    updateConnectState();
    writeStatus("Spotify desconectado deste navegador.");
  });

  function startPolling() {
    window.clearInterval(refreshTimer);
    if (appShell && !appShell.hidden && !panel.hidden && readStoredToken()) {
      refreshPlayback();
      refreshTimer = window.setInterval(refreshPlayback, 20000);
    }
  }

  if (appShell) {
    new MutationObserver(startPolling).observe(appShell, { attributes: true, attributeFilter: ["hidden"] });
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshPlayback();
  });

  clientIdInput.value = clientId;
  settingsForm.hidden = Boolean(clientId);
  updateConnectState();
  if (!clientId) {
    writeStatus("Configure o Client ID para vincular sua conta.");
    trackArtist.textContent = "Só o Client ID — nunca a senha";
  } else if (readStoredToken()) {
    writeStatus("Spotify conectado neste navegador.");
  } else {
    writeStatus("Client ID configurado. Conecte sua conta.");
  }
  completeAuthorization();
  startPolling();
})();