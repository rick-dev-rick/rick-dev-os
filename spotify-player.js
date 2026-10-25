(function () {
  "use strict";

  const redirectUri = "https://rick-dev-rick.github.io/rick-dev-os/";
  const clientIdKey = "rick-dev-spotify-client-id";
  const tokenKey = "rick-dev-spotify-token";
  const verifierKey = "rick-dev-spotify-code-verifier";
  const stateKey = "rick-dev-spotify-oauth-state";
  const browserScopes = ["streaming", "user-read-email", "user-read-private", "user-read-recently-played"];
  const scopes = "user-read-playback-state user-modify-playback-state " + browserScopes.join(" ");
  const lastSourceKey = "rick-dev-spotify-last-source";

  const widget = document.querySelector("#spotify-widget");
  if (!widget) return;

  const appShell = document.querySelector("#app-shell");
  const panel = document.querySelector("#spotify-widget-panel");
  const panelToggle = document.querySelector("#spotify-widget-toggle");
  const status = document.querySelector("#spotify-status");
  const trackTitle = document.querySelector("#spotify-track-title");
  const trackArtist = document.querySelector("#spotify-track-artist");
  const coverImage = document.querySelector("#spotify-cover-image");
  const artFallback = document.querySelector("#spotify-art-fallback");
  const trackLink = document.querySelector("#spotify-track-link");
  const timeline = document.querySelector("#spotify-timeline");
  const elapsedLabel = document.querySelector("#spotify-time-elapsed");
  const durationLabel = document.querySelector("#spotify-time-duration");
  const progressTrack = document.querySelector("#spotify-progress-track");
  const progressFill = document.querySelector("#spotify-progress-fill");
  const previousButton = document.querySelector("#spotify-previous");
  const playButton = document.querySelector("#spotify-play-toggle");
  const nextButton = document.querySelector("#spotify-next");
  const connectButton = document.querySelector("#spotify-connect");
  const disconnectButton = document.querySelector("#spotify-disconnect");
  const settingsToggle = document.querySelector("#spotify-settings-toggle");
  const settingsForm = document.querySelector("#spotify-settings");
  const clientIdInput = document.querySelector("#spotify-client-id");
  const startForm = document.querySelector("#spotify-start-form");
  const sourceInput = document.querySelector("#spotify-start-source");
  const startButton = document.querySelector("#spotify-start-button");

  let clientId = localStorage.getItem(clientIdKey) || "";
  let token = null;
  let playback = null;
  let refreshTimer = null;
  let progressTimer = null;
  let playbackObservedAt = 0;
  let browserPlayer = null;
  let browserDeviceId = null;
  let browserReady = null;
  let cancelBrowserReady = null;
  let sdkLoading = null;
  let browserFailed = false;
  let usingBrowser = false;
  let commandBusy = false;
  let sessionGeneration = 0;
  let refreshTokenPromise = null;

  function hasBrowserPermission() {
    const granted = (readStoredToken()?.scope || "").split(" ");
    return browserScopes.every(function (scope) { return granted.includes(scope); });
  }

  function spotifySource(value) {
    let uri = String(value || "").trim();
    if (uri.startsWith("https://")) {
      try {
        const url = new URL(uri);
        if (url.hostname !== "open.spotify.com") return null;
        const match = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|playlist|album)\/([A-Za-z0-9]{22})\/?$/);
        uri = match ? "spotify:" + match[1] + ":" + match[2] : "";
      } catch (_) { return null; }
    }
    if (!/^spotify:(track|playlist|album):[A-Za-z0-9]{22}$/.test(uri)) return null;
    return uri.startsWith("spotify:track:") ? { uris: [uri] } : { context_uri: uri };
  }

  function loadPlaybackSdk() {
    if (window.Spotify?.Player) return Promise.resolve();
    if (sdkLoading) return sdkLoading;
    sdkLoading = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      const timer = window.setTimeout(failed, 15000);
      function failed() {
        window.clearTimeout(timer);
        script.remove();
        sdkLoading = null;
        reject(new Error("Não consegui carregar o player. Confira a conexão e os bloqueadores do navegador e tente Play novamente."));
      }
      window.onSpotifyWebPlaybackSDKReady = function () { window.clearTimeout(timer); resolve(); };
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.onerror = failed;
      document.head.appendChild(script);
    });
    return sdkLoading;
  }

  function stopBrowserPlayer() {
    sessionGeneration++;
    if (cancelBrowserReady) cancelBrowserReady(new Error("Conexão do player encerrada."));
    if (browserPlayer) browserPlayer.disconnect();
    browserPlayer = null;
    browserDeviceId = null;
    browserReady = null;
    browserFailed = false;
    usingBrowser = false;
    commandBusy = false;
  }

  function ensureBrowserPlayer() {
    if (browserReady) return browserReady;
    const generation = sessionGeneration;
    browserReady = loadPlaybackSdk().then(function () {
      if (generation !== sessionGeneration || !hasBrowserPermission()) throw new Error("Reconecte o Spotify para liberar a reprodução no site.");
      return new Promise(function (resolve, reject) {
        const instance = new window.Spotify.Player({
          name: "RICK_DEV OS", volume: 0.5,
          getOAuthToken: function (callback) { getAccessToken().then(function (value) { if (generation === sessionGeneration) callback(value); }).catch(function (error) { fail(error); }); }
        });
        browserPlayer = instance;
        let failed = false;
        const timer = window.setTimeout(function () { fail(new Error("O player demorou para conectar. Tente Play novamente.")); }, 20000);
        function fail(error) {
          if (failed || generation !== sessionGeneration || browserPlayer !== instance) return;
          failed = true;
          window.clearTimeout(timer);
          instance.disconnect();
          browserDeviceId = null;
          browserPlayer = null;
          browserReady = null;
          browserFailed = true;
          cancelBrowserReady = null;
          writeStatus(error.message);
          showTrack(playback);
          updateConnectState();
          reject(error);
        }
        cancelBrowserReady = function (error) { window.clearTimeout(timer); cancelBrowserReady = null; reject(error); };
        instance.addListener("ready", function (event) {
          if (generation !== sessionGeneration || browserPlayer !== instance) return;
          window.clearTimeout(timer);
          cancelBrowserReady = null;
          browserDeviceId = event.device_id;
          browserFailed = false;
          showTrack(playback);
          updateConnectState();
          if (!playback?.item && !commandBusy) writeStatus("Player pronto. Dê Play para tocar neste navegador.");
          resolve(event.device_id);
        });
        instance.addListener("not_ready", function () {
          if (generation !== sessionGeneration || browserPlayer !== instance) return;
          fail(new Error("O player ficou offline. Tente Play novamente."));
        });
        instance.addListener("player_state_changed", function (state) {
          if (!state || !usingBrowser || generation !== sessionGeneration || browserPlayer !== instance) return;
          const item = state.track_window?.current_track;
          showTrack({ item: item, progress_ms: state.position, is_playing: !state.paused, device: { id: browserDeviceId } });
          writeStatus(state.paused ? "PAUSADO" : "TOCANDO NESTE NAVEGADOR");
        });
        instance.addListener("autoplay_failed", function () {
          if (generation === sessionGeneration) writeStatus("O navegador bloqueou o áudio. Clique em Play novamente para liberar.");
        });
        instance.addListener("initialization_error", function () { fail(new Error("Este navegador não liberou o áudio protegido (DRM). Confira as permissões ou use Chrome/Edge atualizado.")); });
        instance.addListener("authentication_error", function () { fail(new Error("Reconecte o Spotify para renovar a permissão de reprodução.")); });
        instance.addListener("account_error", function () { fail(new Error("A reprodução no navegador exige uma conta Spotify Premium.")); });
        instance.addListener("playback_error", function () {
          if (generation === sessionGeneration) writeStatus("Não consegui tocar essa música. Tente outro link de música ou playlist.");
        });
        Promise.resolve(instance.connect()).then(function (connected) { if (!connected) fail(new Error("Não consegui conectar o player. Tente Play novamente.")); }).catch(fail);
      });
    }).catch(function (error) {
      if (generation === sessionGeneration) { browserReady = null; browserFailed = true; }
      throw error;
    });
    return browserReady;
  }

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

  function formatTime(milliseconds) {
    const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function httpsUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; }
    catch (_) { return null; }
  }

  function resetArtwork() {
    coverImage.hidden = true;
    coverImage.removeAttribute("src");
    artFallback.hidden = false;
  }

  function updateArtwork(item) {
    const images = item && (item.album && item.album.images || item.images);
    const image = Array.isArray(images) && images.find(function (entry) { return entry && httpsUrl(entry.url); });
    const source = image && httpsUrl(image.url);
    if (source) {
      if (coverImage.getAttribute("src") !== source) coverImage.setAttribute("src", source);
      coverImage.hidden = false;
      artFallback.hidden = true;
    } else resetArtwork();
    const url = item && item.external_urls && httpsUrl(item.external_urls.spotify);
    trackLink.setAttribute("href", url || "https://open.spotify.com/");
    trackLink.setAttribute("aria-label", item && item.name ? "Abrir " + item.name + " no Spotify" : "Abrir Spotify");
  }

  function renderTimeline() {
    const item = playback && playback.item;
    const duration = item && item.duration_ms;
    const position = playback && playback.progress_ms;
    const known = Number.isFinite(duration) && duration > 0 && Number.isFinite(position) && position >= 0;
    timeline.hidden = !known;
    if (!known) {
      elapsedLabel.textContent = "0:00";
      durationLabel.textContent = "0:00";
      progressFill.style.width = "0%";
      progressTrack.setAttribute("aria-valuenow", "0");
      progressTrack.setAttribute("aria-valuetext", "Sem reprodução disponível");
      return;
    }
    const elapsed = Math.min(duration, position + (playback.is_playing ? Math.max(0, Date.now() - playbackObservedAt) : 0));
    const percent = elapsed / duration * 100;
    elapsedLabel.textContent = formatTime(elapsed);
    durationLabel.textContent = formatTime(duration);
    progressFill.style.width = percent + "%";
    progressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
    progressTrack.setAttribute("aria-valuetext", formatTime(elapsed) + " de " + formatTime(duration));
  }

  coverImage.addEventListener("error", resetArtwork);

  function showTrack(state) {
    playback = state;
    playbackObservedAt = Date.now();
    const item = state && state.item;
    updateArtwork(item);
    renderTimeline();
    if (!item) {
      trackTitle.textContent = "Seu Spotify está pronto";
      trackArtist.textContent = "Dê o primeiro Play por aqui";
      playButton.textContent = "▶";
      playButton.setAttribute("aria-label", "Reproduzir");
      previousButton.disabled = true;
      playButton.disabled = commandBusy || !readStoredToken() || (hasBrowserPermission() && !browserDeviceId && !browserFailed);
      nextButton.disabled = true;
      return;
    }

    trackTitle.textContent = item.name || "Faixa do Spotify";
    trackArtist.textContent = (item.artists || []).map(function (artist) { return artist.name; }).join(", ") || "Spotify";
    const isPlaying = Boolean(state.is_playing);
    playButton.textContent = isPlaying ? "Ⅱ" : "▶";
    playButton.setAttribute("aria-label", isPlaying ? "Pausar" : "Retomar reprodução");
    previousButton.disabled = commandBusy;
    playButton.disabled = commandBusy;
    nextButton.disabled = commandBusy;
    const source = spotifySource(state.context?.uri) || spotifySource(item.uri);
    if (source) localStorage.setItem(lastSourceKey, source.context_uri || source.uris[0]);
  }

  function updateConnectState() {
    const saved = readStoredToken();
    const connected = Boolean(saved && saved.refreshToken);
    connectButton.hidden = connected && hasBrowserPermission();
    connectButton.textContent = connected ? "RECONECTAR SPOTIFY" : "CONECTAR SPOTIFY";
    disconnectButton.hidden = !connected;
    if (startButton) startButton.disabled = !connected || commandBusy || (hasBrowserPermission() && !browserDeviceId && !browserFailed);
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
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      scope: data.scope || readStoredToken()?.scope || ""
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
      localStorage.removeItem(lastSourceKey);
      writeStatus("Spotify conectado. Carregando sua reprodução…");
      startPolling();
    } catch (error) {
      writeStatus(error.message || "Não consegui conectar ao Spotify.");
    }
  }

  async function getAccessToken() {
    if (refreshTokenPromise) return refreshTokenPromise;
    refreshTokenPromise = resolveAccessToken();
    try { return await refreshTokenPromise; }
    finally { refreshTokenPromise = null; }
  }

  async function resolveAccessToken() {
    const generation = sessionGeneration;
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
      if (generation !== sessionGeneration) throw new Error("Conexão encerrada.");
      localStorage.removeItem(tokenKey);
      updateConnectState();
      throw new Error("Sua autorização venceu. Conecte o Spotify novamente.");
    }
    if (generation !== sessionGeneration) throw new Error("Conexão encerrada.");
    saveTokens(data, saved.refreshToken);
    return token;
  }

  async function apiRequest(path, method, payload) {
    const generation = sessionGeneration;
    const accessToken = await getAccessToken();
    if (generation !== sessionGeneration) throw new Error("Conexão encerrada.");
    const response = await fetch("https://api.spotify.com/v1" + path, {
      method: method || "GET",
      headers: { Authorization: "Bearer " + accessToken, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {})
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
    if (error.status === 404) return "O dispositivo ficou indisponível. Dê Play novamente para tocar neste navegador.";
    if (error.status === 429) return "O Spotify pediu para aguardar antes de tentar de novo.";
    return error.message || "Não consegui falar com o Spotify.";
  }

  async function refreshPlayback() {
    if (!appShell || appShell.hidden || panel.hidden || window.rickMusicProvider === "soundcloud" || !readStoredToken()) return;
    const generation = sessionGeneration;
    try {
      const state = await apiRequest("/me/player");
      if (generation !== sessionGeneration || commandBusy) return;
      usingBrowser = Boolean(browserDeviceId && state?.device?.id === browserDeviceId);
      showTrack(state);
      if (state && state.item) {
        writeStatus(state.is_playing ? "TOCANDO AGORA" : "PAUSADO");
      } else {
        if (!browserFailed) writeStatus(hasBrowserPermission() ? (browserDeviceId ? "Conectado. Clique em Play para tocar aqui." : "Preparando o player neste navegador…") : "Reconecte o Spotify uma vez para liberar o primeiro Play no site.");
      }
    } catch (error) {
      if (generation === sessionGeneration && !commandBusy) writeStatus(explainApiError(error));
    }
  }

  async function firstPlay(explicitSource, generation) {
    if (!hasBrowserPermission()) throw new Error("Reconecte o Spotify uma vez para liberar a reprodução no site.");
    browserFailed = false;
    const deviceId = await ensureBrowserPlayer();
    if (generation !== sessionGeneration) return;
    let source = explicitSource || spotifySource(localStorage.getItem(lastSourceKey));
    if (!source) {
      try {
        const recent = await apiRequest("/me/player/recently-played?limit=1");
        source = spotifySource(recent?.items?.[0]?.track?.uri);
      } catch (error) {
        if (error.status !== 403 && error.status !== 404) throw error;
      }
    }
    if (!source) throw new Error("Cole abaixo um link de música ou playlist do Spotify para começar.");
    if (generation !== sessionGeneration) return;
    await apiRequest("/me/player", "PUT", { device_ids: [deviceId], play: false });
    if (generation !== sessionGeneration) return;
    usingBrowser = true;
    await apiRequest("/me/player/play?device_id=" + encodeURIComponent(deviceId), "PUT", source);
  }

  async function sendPlaybackCommand(command, explicitSource) {
    if (commandBusy) return;
    if (!readStoredToken()) {
      writeStatus("Conecte sua conta do Spotify primeiro.");
      return;
    }
    const generation = sessionGeneration;
    if (command === "toggle" && (explicitSource || !playback?.item) && hasBrowserPermission() && !browserPlayer) {
      browserFailed = false;
      showTrack(playback);
      updateConnectState();
      writeStatus("Preparando o player neste navegador…");
      try {
        await ensureBrowserPlayer();
        if (generation === sessionGeneration) writeStatus("Player pronto. Clique em Play ou TOCAR AQUI para começar.");
      } catch (error) {
        if (generation === sessionGeneration) { writeStatus(error.message); showTrack(playback); updateConnectState(); }
      }
      return;
    }
    // Must run in the click/submit gesture, before token or network awaits (iOS).
    const activation = browserPlayer && command === "toggle" && (explicitSource || !playback?.is_playing) ? browserPlayer.activateElement() : Promise.resolve();
    commandBusy = true;
    if (startButton) startButton.disabled = true;
    [previousButton, playButton, nextButton].forEach(function (button) { button.disabled = true; });
    try {
      await activation;
      if (command === "toggle" && (explicitSource || !playback?.is_playing) && (playback?.item || hasBrowserPermission())) window.rickSoundCloudControl?.pause();
      if (command === "toggle") {
        if (explicitSource || !playback?.item) {
          writeStatus("Preparando a reprodução neste navegador…");
          await firstPlay(explicitSource, generation);
        } else {
          const target = usingBrowser && browserDeviceId ? "?device_id=" + encodeURIComponent(browserDeviceId) : "";
          try {
            await apiRequest((playback.is_playing ? "/me/player/pause" : "/me/player/play") + target, "PUT");
          } catch (error) {
            if (error.status !== 404 || playback.is_playing) throw error;
            await firstPlay(null, generation);
          }
        }
      } else if (command === "previous") {
        await apiRequest("/me/player/previous", "POST");
      } else {
        await apiRequest("/me/player/next", "POST");
      }
      if (generation === sessionGeneration) {
        writeStatus("Comando enviado ao Spotify…");
        window.setTimeout(refreshPlayback, 900);
      }
    } catch (error) {
      if (generation === sessionGeneration) writeStatus(explainApiError(error));
    } finally {
      if (generation === sessionGeneration) { commandBusy = false; showTrack(playback); updateConnectState(); }
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
    panelToggle.setAttribute("aria-label", minimized ? "Abrir player de músicas" : "Minimizar player de músicas");
    panelToggle.title = minimized ? "Abrir player de músicas" : "Minimizar player de músicas";
    localStorage.setItem("rick-dev-spotify-widget-minimized", String(minimized));
    if (minimized) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
      window.clearInterval(progressTimer);
      progressTimer = null;
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
  playButton.addEventListener("click", function () { return sendPlaybackCommand("toggle"); });
  nextButton.addEventListener("click", function () { sendPlaybackCommand("next"); });
  if (startForm) startForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const source = spotifySource(sourceInput.value);
    if (!source) { writeStatus("Cole um link completo de música, álbum ou playlist do Spotify."); return; }
    return sendPlaybackCommand("toggle", source);
  });

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
      stopBrowserPlayer();
      localStorage.removeItem(lastSourceKey);
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
    stopBrowserPlayer();
    localStorage.removeItem(lastSourceKey);
    localStorage.removeItem(tokenKey);
    token = null;
    playback = null;
    window.clearInterval(refreshTimer);
    refreshTimer = null;
    window.clearInterval(progressTimer);
    progressTimer = null;
    showTrack(null);
    updateConnectState();
    writeStatus("Spotify desconectado deste navegador.");
  });

  function startPolling() {
    window.clearInterval(refreshTimer);
    window.clearInterval(progressTimer);
    refreshTimer = null;
    progressTimer = null;
    if (appShell && !appShell.hidden && !panel.hidden && !document.hidden && window.rickMusicProvider !== "soundcloud" && readStoredToken()) {
      if (hasBrowserPermission() && !browserFailed) {
        const generation = sessionGeneration;
        ensureBrowserPlayer().catch(function (error) {
          if (generation === sessionGeneration) { writeStatus(error.message); showTrack(playback); updateConnectState(); }
        });
      }
      refreshPlayback();
      refreshTimer = window.setInterval(refreshPlayback, 20000);
      progressTimer = window.setInterval(renderTimeline, 1000);
    }
  }

  async function pauseForOtherProvider() {
    if (!readStoredToken() || window.rickMusicProvider === "spotify") return;
    const generation = sessionGeneration;
    const current = await apiRequest("/me/player");
    if (generation !== sessionGeneration || window.rickMusicProvider === "spotify" || !current?.is_playing) return;
    await apiRequest("/me/player/pause", "PUT");
    if (generation === sessionGeneration) { showTrack({ ...current, is_playing: false }); writeStatus("PAUSADO"); }
  }
  window.rickSpotifyControl = Object.freeze({ pause: pauseForOtherProvider });
  window.addEventListener("rick-music-provider-change", startPolling);

  if (appShell) {
    new MutationObserver(startPolling).observe(appShell, { attributes: true, attributeFilter: ["hidden"] });
  }
  document.addEventListener("visibilitychange", function () {
    startPolling();
  });

  clientIdInput.value = clientId;
  showTrack(null);
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
