(function () {
  const PIXI_URL = "./vendor/pixi.mjs";
  const DEFAULT_GLOW = 0x66b8e8;
  const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
  const motionMedia = window.matchMedia(MOTION_QUERY);

  const LUXE_VERTEX = `precision highp float;
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`;

  const LUXE_FRAGMENT = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uTime;
uniform vec2 uPointer;
uniform vec4 uGlowColor;
uniform float uHover;
uniform float uSelected;
uniform float uObtained;
uniform float uAutoShine;

float band(float value, float center, float width) {
  return 1.0 - smoothstep(0.0, width, abs(value - center));
}

vec3 prism(float t) {
  return 0.55 + 0.45 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + t));
}

void main(void) {
  vec2 uv = vTextureCoord;
  vec4 base = texture(uTexture, uv);
  vec2 px = uInputSize.zw * 1.55;

  float a0 = base.a;
  float alphaNear = 0.0;
  alphaNear = max(alphaNear, texture(uTexture, uv + vec2(px.x, 0.0)).a);
  alphaNear = max(alphaNear, texture(uTexture, uv - vec2(px.x, 0.0)).a);
  alphaNear = max(alphaNear, texture(uTexture, uv + vec2(0.0, px.y)).a);
  alphaNear = max(alphaNear, texture(uTexture, uv - vec2(0.0, px.y)).a);
  alphaNear = max(alphaNear, texture(uTexture, uv + vec2(px.x, px.y)).a);
  alphaNear = max(alphaNear, texture(uTexture, uv + vec2(-px.x, px.y)).a);
  alphaNear = max(alphaNear, texture(uTexture, uv + vec2(px.x, -px.y)).a);
  alphaNear = max(alphaNear, texture(uTexture, uv - vec2(px.x, px.y)).a);

  float body = smoothstep(0.02, 0.34, a0);
  float halo = max(alphaNear - a0, 0.0);
  float rim = smoothstep(0.05, 0.7, alphaNear) * (1.0 - smoothstep(0.12, 0.92, a0));
  float luma = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));

  float pointerLight = smoothstep(0.92, 0.0, distance(uv, uPointer));
  float sweep = fract((uv.x * 0.92 + uv.y * 0.58) - uTime * 0.075 + uPointer.x * 0.16 - uPointer.y * 0.10);
  float sheen = band(sweep, 0.52, 0.12) * body;
  float hairline = band(sweep, 0.50, 0.026) * body;
  float grain = sin(uv.x * 43.0 + uv.y * 27.0 + uTime * 2.0 + uPointer.x * 2.5) * 0.5 + 0.5;
  float shineDrive = max(uHover, uAutoShine * 0.62);
  float sparkle = pow(grain, 8.0) * body * (shineDrive * 0.18 + uSelected * 0.05);

  vec3 glow = uGlowColor.rgb;
  vec3 effect = vec3(0.0);
  effect += glow * halo * (0.72 + uHover * 1.02 + uSelected * 0.34);
  effect += mix(glow, vec3(1.0), 0.36) * rim * (0.15 + uHover * 0.22 + uSelected * 0.06);
  effect += prism(sweep + grain * 0.08 + uPointer.x * 0.16) * sheen * (shineDrive * 0.34 + uSelected * 0.08) * (0.58 + luma);
  effect += vec3(1.0) * hairline * (shineDrive * 0.12);
  effect += prism(grain + uTime * 0.04) * sparkle;
  effect += base.rgb * pointerLight * body * (0.035 + uHover * 0.075);

  float effectAlpha = halo * (0.30 + uHover * 0.26 + uSelected * 0.08);
  effectAlpha += rim * (0.09 + uHover * 0.11 + uSelected * 0.03);
  effectAlpha += sheen * (shineDrive * 0.18 + uSelected * 0.04);
  effectAlpha += hairline * (shineDrive * 0.095);
  effectAlpha += sparkle * 0.45;
  effectAlpha = clamp(effectAlpha * mix(0.84, 1.0, uObtained), 0.0, 0.68);
  finalColor = vec4(effect, effectAlpha);
}
`;

  let pixiPromise;
  let PIXI;
  let gridApp;
  let gridLayer;
  let gridElement;
  let gridResizeObserver;
  let scrollHandler;
  let rafPending = false;
  let detailRenderer;
  let detailElement;

  const tiles = new Map();
  const detailState = { record: null };
  const cardRenderers = new WeakMap();
  const colorCache = new Map();
  const texturePromises = new Map();
  const imageUrlCache = new Map();

  function loadPixi() {
    if (!pixiPromise) {
      pixiPromise = import(PIXI_URL).then((module) => {
        PIXI = module;
        return module;
      });
    }
    return pixiPromise;
  }

  function reducedMotion() {
    return motionMedia.matches;
  }

  function toHexColor(value) {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return DEFAULT_GLOW;
    const trimmed = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
      return Number.parseInt(trimmed.slice(1), 16);
    }
    if (/^0x[0-9a-f]{6}$/i.test(trimmed)) {
      return Number.parseInt(trimmed.slice(2), 16);
    }
    return DEFAULT_GLOW;
  }

  function rgbUnit(color) {
    const value = toHexColor(color);
    return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
  }

  function colorToCss(color) {
    return `#${toHexColor(color).toString(16).padStart(6, "0")}`;
  }

  function getLocalBadgeImageUrl(badge) {
    if (!badge) return "";
    if (imageUrlCache.has(badge.id)) return imageUrlCache.get(badge.id);
    const extension = (badge.imageUrl || "").split("?")[0].split(".").pop() || "png";
    const url = `sh-dump/badges/${badge.id}.${extension}`;
    imageUrlCache.set(badge.id, url);
    return url;
  }

  function loadTexture(url) {
    if (!url) return Promise.resolve(null);
    if (!texturePromises.has(url)) {
      texturePromises.set(
        url,
        loadPixi()
          .then(() => PIXI.Assets.load(url))
          .catch((error) => {
            console.warn("Badge texture failed to load", url, error);
            return null;
          })
      );
    }
    return texturePromises.get(url);
  }

  function sampleBadgeGlow(badge) {
    if (!badge) return Promise.resolve(DEFAULT_GLOW);
    if (colorCache.has(badge.id)) return Promise.resolve(colorCache.get(badge.id));

    const url = getLocalBadgeImageUrl(badge);
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const size = 24;
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0, size, size);
          const pixels = context.getImageData(0, 0, size, size).data;
          let r = 0;
          let g = 0;
          let b = 0;
          let weight = 0;

          for (let i = 0; i < pixels.length; i += 4) {
            const alpha = pixels[i + 3] / 255;
            if (alpha < 0.18) continue;
            const pr = pixels[i];
            const pg = pixels[i + 1];
            const pb = pixels[i + 2];
            const vivid = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
            const luma = pr * 0.2126 + pg * 0.7152 + pb * 0.0722;
            if (luma < 24) continue;
            const sampleWeight = alpha * (0.35 + vivid / 255) * (luma > 230 ? 0.35 : 1);
            r += pr * sampleWeight;
            g += pg * sampleWeight;
            b += pb * sampleWeight;
            weight += sampleWeight;
          }

          let color = DEFAULT_GLOW;
          if (weight > 0) {
            r = Math.min(255, Math.round((r / weight) * 1.08));
            g = Math.min(255, Math.round((g / weight) * 1.08));
            b = Math.min(255, Math.round((b / weight) * 1.08));
            color = (r << 16) | (g << 8) | b;
          }
          colorCache.set(badge.id, color);
          resolve(color);
        } catch (error) {
          colorCache.set(badge.id, DEFAULT_GLOW);
          resolve(DEFAULT_GLOW);
        }
      };
      image.onerror = () => {
        colorCache.set(badge.id, DEFAULT_GLOW);
        resolve(DEFAULT_GLOW);
      };
      image.src = url;
    });
  }

  function createLuxeFilter(padding) {
    const filter = PIXI.Filter.from({
      gl: { vertex: LUXE_VERTEX, fragment: LUXE_FRAGMENT },
      resources: {
        badgeUniforms: {
          uTime: { value: 0, type: "f32" },
          uPointer: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
          uGlowColor: { value: new Float32Array([0.4, 0.72, 1.0, 1.0]), type: "vec4<f32>" },
          uHover: { value: 0, type: "f32" },
          uSelected: { value: 0, type: "f32" },
          uObtained: { value: 1, type: "f32" },
          uAutoShine: { value: 1, type: "f32" },
        },
      },
      padding,
      antialias: "on",
      resolution: 1,
    });
    filter.badgeUniforms = filter.resources.badgeUniforms.uniforms;
    return filter;
  }

  function updateLuxeUniforms(filter, state, detailMode) {
    if (!filter) return;
    const uniforms = filter.badgeUniforms;
    const [r, g, b] = rgbUnit(state.color);
    uniforms.uTime = reducedMotion() ? 0 : state.time;
    uniforms.uPointer[0] = state.x;
    uniforms.uPointer[1] = state.y;
    uniforms.uGlowColor[0] = r;
    uniforms.uGlowColor[1] = g;
    uniforms.uGlowColor[2] = b;
    uniforms.uGlowColor[3] = 1;
    uniforms.uHover = reducedMotion() ? 0 : Math.max(0, Math.min(1, state.hover + (detailMode ? 0.18 : 0)));
    uniforms.uSelected = state.selected ? 1 : 0;
    uniforms.uObtained = state.obtained ? 1 : 0;
    uniforms.uAutoShine = !reducedMotion() && state.autoShine !== false ? 1 : 0;
  }

  function createBadgeMesh(texture, vertices) {
    return new PIXI.PerspectiveMesh({
      texture,
      verticesX: vertices,
      verticesY: vertices,
    });
  }

  function createTextureAura(texture, strength, quality) {
    const mesh = createBadgeMesh(texture, 12);
    const blur = new PIXI.BlurFilter({
      strength,
      quality,
      kernelSize: 7,
      repeatEdgePixels: false,
    });
    blur.padding = Math.ceil(strength * 5);
    mesh.blendMode = "add";
    mesh.filters = [blur];
    return mesh;
  }

  function applyProjectedCorners(mesh, centerX, centerY, width, height, yaw, pitch, lift) {
    if (!mesh) return;
    const halfW = width / 2;
    const halfH = height / 2;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosX = Math.cos(pitch);
    const sinX = Math.sin(pitch);
    const perspective = Math.max(width, height) * 3.4;
    const points = [
      [-halfW, -halfH, 0],
      [halfW, -halfH, 0],
      [halfW, halfH, 0],
      [-halfW, halfH, 0],
    ].map(([x, y, z]) => {
      const y1 = y * cosX - z * sinX;
      const z1 = y * sinX + z * cosX;
      const x2 = x * cosY + z1 * sinY;
      const z2 = -x * sinY + z1 * cosY;
      const scale = perspective / Math.max(perspective + z2, perspective * 0.45);
      return [centerX + x2 * scale, centerY + y1 * scale - lift * scale];
    });

    mesh.setCorners(
      points[0][0],
      points[0][1],
      points[1][0],
      points[1][1],
      points[2][0],
      points[2][1],
      points[3][0],
      points[3][1]
    );
  }

  function ensureGridCanvas(badgeGrid) {
    if (gridApp && gridElement === badgeGrid) {
      if (!badgeGrid.contains(gridApp.canvas)) {
        badgeGrid.prepend(gridApp.canvas);
      }
      return Promise.resolve();
    }

    return loadPixi().then(async () => {
      if (gridApp) {
        destroyGrid();
      }

      gridElement = badgeGrid;
      badgeGrid.classList.add("pixi-grid-ready");

      gridApp = new PIXI.Application();
      await gridApp.init({
        width: Math.max(1, badgeGrid.scrollWidth),
        height: Math.max(1, badgeGrid.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        preference: "webgl",
      });

      gridApp.canvas.className = "badge-pixi-canvas";
      gridApp.canvas.setAttribute("aria-hidden", "true");
      gridLayer = new PIXI.Container();
      gridApp.stage.addChild(gridLayer);
      badgeGrid.prepend(gridApp.canvas);

      scrollHandler = () => requestLayout();
      badgeGrid.addEventListener("scroll", scrollHandler, { passive: true });
      gridResizeObserver = new ResizeObserver(() => requestLayout());
      gridResizeObserver.observe(badgeGrid);
      gridApp.ticker.add(updateGrid);
    });
  }

  function resizeGridCanvas() {
    if (!gridApp || !gridElement) return;
    const width = Math.max(1, gridElement.scrollWidth);
    const height = Math.max(1, gridElement.clientHeight);
    if (gridApp.renderer.width !== width || gridApp.renderer.height !== height) {
      gridApp.renderer.resize(width, height);
    }
    gridApp.canvas.style.width = `${width}px`;
    gridApp.canvas.style.height = `${height}px`;
  }

  function requestLayout() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      layoutTiles();
    });
  }

  function createTileRecord(card) {
    const container = new PIXI.Container();
    container.eventMode = "none";

    const content = new PIXI.Container();
    const mask = new PIXI.Graphics();
    const meshLayer = new PIXI.Container();
    content.mask = mask;
    content.addChild(meshLayer);
    container.addChild(mask, content);
    gridLayer.addChild(container);

    return {
      id: card.dataset.badgeId,
      card,
      container,
      content,
      mask,
      meshLayer,
      mesh: null,
      fxMesh: null,
      auraMesh: null,
      rimMesh: null,
      luxeFilter: createLuxeFilter(14),
      texture: null,
      x: 0.5,
      y: 0.5,
      targetX: 0.5,
      targetY: 0.5,
      hover: 0,
      targetHover: 0,
      selected: false,
      exportSelected: false,
      obtained: false,
      color: DEFAULT_GLOW,
      time: Math.random() * 10,
    };
  }

  function drawTileStatic(record, width, height) {
    const radius = Math.max(12, Math.min(22, width * 0.18));
    record.mask.clear().roundRect(0, 0, width, height, radius).fill(0xffffff);
  }

  function updateTileEffects(record) {
    const hover = reducedMotion() ? 0 : record.hover;
    const selected = record.selected ? 1 : 0;
    const obtained = record.obtained ? 1 : 0.78;

    if (record.auraMesh) {
      record.auraMesh.tint = record.color;
      record.auraMesh.alpha = (0.04 + hover * 0.075 + selected * 0.025) * obtained;
    }
    if (record.rimMesh) {
      record.rimMesh.tint = record.color;
      record.rimMesh.alpha = (0.055 + hover * 0.085 + selected * 0.035) * obtained;
    }
    if (record.fxMesh) {
      record.fxMesh.alpha = (0.20 + hover * 0.14 + selected * 0.06) * obtained;
    }
    if (record.mesh) {
      record.mesh.alpha = 0.95 + obtained * 0.05;
    }

    updateLuxeUniforms(record.luxeFilter, record, false);
  }

  function setImageCorners(record, width, height) {
    if (!record.mesh) return;
    const hover = reducedMotion() ? 0 : record.hover;
    const slotWidth = record.slotWidth || width;
    const slotHeight = record.slotHeight || height;
    const pad = record.visualPad || 0;
    const imageSize = Math.max(42, Math.min(slotWidth, slotHeight) * (0.98 + hover * 0.025));
    const centerX = pad + slotWidth / 2 + (record.x - 0.5) * 1.6 * hover;
    const centerY = pad + slotHeight / 2 + (record.y - 0.5) * 1.3 * hover;
    const yaw = (record.x - 0.5) * 0.92 * hover;
    const pitch = -(record.y - 0.5) * 0.78 * hover;
    const lift = 1.6 * hover;

    applyProjectedCorners(record.auraMesh, centerX, centerY, imageSize * 1.28, imageSize * 1.28, yaw * 1.04, pitch * 1.04, lift * 0.35);
    applyProjectedCorners(record.rimMesh, centerX, centerY, imageSize * 1.12, imageSize * 1.12, yaw * 1.02, pitch * 1.02, lift * 0.5);
    applyProjectedCorners(record.mesh, centerX, centerY, imageSize, imageSize, yaw, pitch, lift);
    applyProjectedCorners(record.fxMesh, centerX, centerY, imageSize, imageSize, yaw, pitch, lift);
  }

  function setRecordTexture(record, texture) {
    record.meshLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    record.texture = texture;
    record.auraMesh = createTextureAura(texture, 8, 3);
    record.rimMesh = createTextureAura(texture, 3, 2);
    record.rimMesh.blendMode = "screen";
    record.fxMesh = createBadgeMesh(texture, 16);
    record.fxMesh.blendMode = "screen";
    record.fxMesh.filters = [record.luxeFilter];
    record.mesh = createBadgeMesh(texture, 16);
    record.meshLayer.addChild(record.auraMesh, record.rimMesh, record.mesh, record.fxMesh);
    record.card?.classList.remove("is-loading", "load-error");
    if (record.width && record.height) {
      updateTileEffects(record);
      setImageCorners(record, record.width, record.height);
    }
  }

  function layoutTiles() {
    if (!gridApp || !gridElement) return;
    resizeGridCanvas();
    const gridRect = gridElement.getBoundingClientRect();

    tiles.forEach((record) => {
      const rect = record.card.getBoundingClientRect();
      const slot = record.card.querySelector(".badge-pixi-slot");
      const slotRect = slot ? slot.getBoundingClientRect() : rect;
      const visualPad = Math.max(12, Math.min(22, slotRect.width * 0.3));
      const left = slotRect.left - gridRect.left + gridElement.scrollLeft - visualPad;
      const top = slotRect.top - gridRect.top + gridElement.scrollTop - visualPad;
      const width = slotRect.width + visualPad * 2;
      const height = slotRect.height + visualPad * 2;
      record.container.position.set(left, top);
      record.container.visible = width > 0 && height > 0 && rect.right >= gridRect.left - 120 && rect.left <= gridRect.right + 120;
      record.width = width;
      record.height = height;
      record.slotWidth = slotRect.width;
      record.slotHeight = slotRect.height;
      record.visualPad = visualPad;
      drawTileStatic(record, width, height);
      setImageCorners(record, width, height);
    });
  }

  function updateGrid(ticker) {
    if (!gridApp) return;
    const delta = ticker.deltaTime;
    tiles.forEach((record) => {
      if (!reducedMotion()) {
        record.time += delta / 60;
        const pointerFollow = Math.min(1, delta * 0.42);
        const hoverFollow = Math.min(1, delta * 0.34);
        record.x += (record.targetX - record.x) * pointerFollow;
        record.y += (record.targetY - record.y) * pointerFollow;
        record.hover += (record.targetHover - record.hover) * hoverFollow;
      }
      if (!record.width || !record.height) return;
      updateTileEffects(record);
      setImageCorners(record, record.width, record.height);
    });
  }

  function syncGrid({ badgeGrid, cards, badges }) {
    if (!badgeGrid || !cards) return;
    ensureGridCanvas(badgeGrid).then(() => {
      const badgeById = new Map((badges || []).map((badge) => [String(badge.id), badge]));
      const activeIds = new Set();

      cards.forEach((card) => {
        const id = card.dataset.badgeId;
        activeIds.add(id);
        let record = tiles.get(id);
        if (!record) {
          record = createTileRecord(card);
          tiles.set(id, record);
        }

        record.card = card;
        record.selected = card.classList.contains("selected");
        record.exportSelected = card.classList.contains("export-selected");
        record.obtained = card.classList.contains("obtained");
        const badge = badgeById.get(id);
        const imageUrl = card.dataset.imageUrl || getLocalBadgeImageUrl(badge);
        if (record.texture && record.imageUrl === imageUrl) {
          card.classList.remove("is-loading", "load-error");
        }

        sampleBadgeGlow(badge).then((color) => {
          if (!tiles.has(id)) return;
          record.color = color;
          card.dataset.glow = colorToCss(color);
          card.style.setProperty("--badge-glow", colorToCss(color));
        });

        if (imageUrl && record.imageUrl !== imageUrl) {
          record.imageUrl = imageUrl;
          loadTexture(imageUrl).then((texture) => {
            if (!tiles.has(id) || record.imageUrl !== imageUrl) return;
            if (!texture) {
              record.card?.classList.remove("is-loading");
              record.card?.classList.add("load-error");
              return;
            }
            setRecordTexture(record, texture);
          });
        }
      });

      tiles.forEach((record, id) => {
        if (!activeIds.has(id)) {
          record.container.destroy({ children: true });
          tiles.delete(id);
        }
      });

      requestLayout();
    });
  }

  function updatePointer(card, event) {
    const id = card.dataset.badgeId;
    const record = tiles.get(id);
    if (!record) return;
    const rect = (card.querySelector(".badge-pixi-slot") || card).getBoundingClientRect();
    record.targetX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    record.targetY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    record.targetHover = reducedMotion() ? 0 : 1;
  }

  function leavePointer(card) {
    const id = card.dataset.badgeId;
    const record = tiles.get(id);
    if (!record) return;
    record.targetX = 0.5;
    record.targetY = 0.5;
    record.targetHover = 0;
  }

  function ensureDetailRenderer(element) {
    if (detailRenderer && detailElement === element) return Promise.resolve();

    return loadPixi().then(async () => {
      if (detailRenderer) {
        detailRenderer.app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
      }

      detailElement = element;
      element.innerHTML = "";
      element.classList.add("pixi-detail-ready");

      const app = new PIXI.Application();
      await app.init({
        width: Math.max(1, element.clientWidth),
        height: Math.max(1, element.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        preference: "webgl",
      });
      app.canvas.className = "badge-detail-canvas";
      app.canvas.setAttribute("aria-hidden", "true");
      element.appendChild(app.canvas);

      const container = new PIXI.Container();
      const content = new PIXI.Container();
      const mask = new PIXI.Graphics();
      const meshLayer = new PIXI.Container();
      content.mask = mask;
      content.addChild(meshLayer);
      container.addChild(mask, content);
      app.stage.addChild(container);

      detailRenderer = {
        app,
        container,
        content,
        mask,
        meshLayer,
        mesh: null,
        fxMesh: null,
        auraMesh: null,
        rimMesh: null,
        luxeFilter: createLuxeFilter(22),
        color: DEFAULT_GLOW,
        time: 0,
        x: 0.48,
        y: 0.45,
        hover: 0.24,
        selected: true,
        obtained: true,
      };
      app.ticker.add((ticker) => updateDetail(ticker));
    });
  }

  function setDetailTexture(renderer, texture) {
    renderer.meshLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    renderer.auraMesh = createTextureAura(texture, 12, 4);
    renderer.rimMesh = createTextureAura(texture, 4, 2);
    renderer.rimMesh.blendMode = "screen";
    renderer.fxMesh = createBadgeMesh(texture, 18);
    renderer.fxMesh.blendMode = "screen";
    renderer.fxMesh.filters = [renderer.luxeFilter];
    renderer.mesh = createBadgeMesh(texture, 18);
    renderer.meshLayer.addChild(renderer.auraMesh, renderer.rimMesh, renderer.mesh, renderer.fxMesh);
  }

  function updateDetail(ticker) {
    if (!detailRenderer || !detailElement) return;
    const renderer = detailRenderer;
    if (!reducedMotion()) renderer.time += ticker.deltaTime / 70;
    const width = Math.max(1, detailElement.clientWidth);
    const height = Math.max(1, detailElement.clientHeight);
    if (renderer.app.renderer.width !== width || renderer.app.renderer.height !== height) {
      renderer.app.renderer.resize(width, height);
    }
    renderer.app.canvas.style.width = `${width}px`;
    renderer.app.canvas.style.height = `${height}px`;

    const radius = 8;
    renderer.mask.clear().roundRect(0, 0, width, height, radius).fill(0xffffff);

    const idleX = reducedMotion() ? 0 : Math.sin(renderer.time * 0.72) * 0.045;
    const idleY = reducedMotion() ? 0 : Math.cos(renderer.time * 0.58) * 0.038;
    renderer.x = 0.5 + idleX;
    renderer.y = 0.5 + idleY;
    renderer.hover = reducedMotion() ? 0 : 0.28;

    if (renderer.auraMesh) {
      renderer.auraMesh.tint = renderer.color;
      renderer.auraMesh.alpha = 0.16;
    }
    if (renderer.rimMesh) {
      renderer.rimMesh.tint = renderer.color;
      renderer.rimMesh.alpha = 0.18;
    }
    if (renderer.fxMesh) {
      renderer.fxMesh.alpha = 0.38;
    }

    updateLuxeUniforms(renderer.luxeFilter, renderer, true);

    if (renderer.mesh) {
      const size = Math.min(width, height) * 0.82;
      const cx = width / 2 + idleX * width * 0.16;
      const cy = height / 2 + idleY * height * 0.12;
      const yaw = idleX * 4.5;
      const pitch = -idleY * 4.0;
      applyProjectedCorners(renderer.auraMesh, cx, cy, size * 1.18, size * 1.18, yaw * 1.18, pitch * 1.18, 1.5);
      applyProjectedCorners(renderer.rimMesh, cx, cy, size * 1.05, size * 1.05, yaw * 1.08, pitch * 1.08, 1.2);
      applyProjectedCorners(renderer.mesh, cx, cy, size, size, yaw, pitch, 1);
      applyProjectedCorners(renderer.fxMesh, cx, cy, size, size, yaw, pitch, 1);
    }
  }

  function renderDetail({ element, badge }) {
    if (!element || !badge) return;
    detailState.record = badge.id;
    ensureDetailRenderer(element).then(() => {
      const renderer = detailRenderer;
      const imageUrl = getLocalBadgeImageUrl(badge);
      sampleBadgeGlow(badge).then((color) => {
        if (detailState.record !== badge.id) return;
        renderer.color = color;
        element.style.setProperty("--badge-glow", colorToCss(color));
      });
      loadTexture(imageUrl).then((texture) => {
        if (!texture || !detailRenderer || detailState.record !== badge.id) return;
        setDetailTexture(renderer, texture);
      });
    });
  }

  function ensureCardRenderer(mount, canvas) {
    const existing = cardRenderers.get(mount);
    if (existing && existing.canvas === canvas) return Promise.resolve(existing);

    return loadPixi().then(async () => {
      if (existing) {
        destroyCardRenderer(mount);
      }

      mount.classList.add("pixi-card-ready");

      const app = new PIXI.Application();
      await app.init({
        width: Math.max(1, mount.clientWidth),
        height: Math.max(1, mount.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        preference: "webgl",
      });

      app.canvas.className = "card-effects-canvas";
      app.canvas.setAttribute("aria-hidden", "true");
      mount.appendChild(app.canvas);

      const layer = new PIXI.Container();
      app.stage.addChild(layer);

      const renderer = {
        app,
        mount,
        canvas,
        layer,
        records: new Map(),
        slots: [],
        pointerSlot: null,
        resizeObserver: null,
        pointerMove: null,
        pointerLeave: null,
        rafPending: false,
      };

      renderer.pointerMove = (event) => updateCardPointer(renderer, event);
      renderer.pointerLeave = () => leaveCardPointer(renderer);
      mount.addEventListener("pointermove", renderer.pointerMove, { passive: true });
      mount.addEventListener("pointerleave", renderer.pointerLeave);

      renderer.resizeObserver = new ResizeObserver(() => requestCardLayout(renderer));
      renderer.resizeObserver.observe(mount);

      app.ticker.add((ticker) => updateCardEffects(renderer, ticker));
      cardRenderers.set(mount, renderer);
      return renderer;
    });
  }

  function createCardRecord(key) {
    const container = new PIXI.Container();
    container.eventMode = "none";

    const content = new PIXI.Container();
    const meshLayer = new PIXI.Container();
    content.mask = null;
    content.addChild(meshLayer);
    container.addChild(content);

    return {
      key,
      container,
      content,
      meshLayer,
      mesh: null,
      fxMesh: null,
      auraMesh: null,
      rimMesh: null,
      luxeFilter: createLuxeFilter(18),
      texture: null,
      imageUrl: "",
      badgeId: null,
      x: 0.5,
      y: 0.5,
      targetX: 0.5,
      targetY: 0.5,
      hover: 0,
      targetHover: 0,
      selected: false,
      obtained: true,
      autoShine: true,
      color: DEFAULT_GLOW,
      time: Math.random() * 12,
      baseHover: 0.12,
      scale: 1,
      slotX: 0,
      slotY: 0,
      slotWidth: 1,
      slotHeight: 1,
      visualPad: 12,
    };
  }

  function setCardRecordTexture(record, texture) {
    record.meshLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    record.texture = texture;
    record.auraMesh = createTextureAura(texture, 8, 3);
    record.rimMesh = createTextureAura(texture, 3, 2);
    record.rimMesh.blendMode = "screen";
    record.fxMesh = createBadgeMesh(texture, 16);
    record.fxMesh.blendMode = "screen";
    record.fxMesh.filters = [record.luxeFilter];
    record.mesh = createBadgeMesh(texture, 16);
    record.meshLayer.addChild(record.auraMesh, record.rimMesh, record.mesh, record.fxMesh);
    updateCardRecordEffects(record);
    setCardImageCorners(record);
  }

  function syncCard({ mount, canvas, slots }) {
    if (!mount || !canvas || !slots) return;
    ensureCardRenderer(mount, canvas).then((renderer) => {
      renderer.slots = slots;
      const activeKeys = new Set();

      slots.forEach((slot) => {
        if (!slot?.badge) return;
        activeKeys.add(slot.key);
        let record = renderer.records.get(slot.key);
        if (!record) {
          record = createCardRecord(slot.key);
          renderer.records.set(slot.key, record);
          renderer.layer.addChild(record.container);
        }

        const badge = slot.badge;
        record.badgeId = badge.id;
        record.slot = slot;
        record.autoShine = slot.autoShine !== false;
        record.baseHover = record.autoShine ? (slot.kind === "favorite" ? 0.07 : 0.05) : 0;
        const imageUrl = slot.imageUrl || getLocalBadgeImageUrl(badge);

        sampleBadgeGlow(badge).then((color) => {
          if (!renderer.records.has(slot.key) || record.badgeId !== badge.id) return;
          record.color = color;
        });

        if (imageUrl && record.imageUrl !== imageUrl) {
          record.imageUrl = imageUrl;
          loadTexture(imageUrl).then((texture) => {
            if (!texture || !renderer.records.has(slot.key) || record.imageUrl !== imageUrl) return;
            setCardRecordTexture(record, texture);
          });
        }
      });

      renderer.records.forEach((record, key) => {
        if (!activeKeys.has(key)) {
          record.container.destroy({ children: true });
          renderer.records.delete(key);
        }
      });

      requestCardLayout(renderer);
    });
  }

  function requestCardLayout(renderer) {
    if (renderer.rafPending) return;
    renderer.rafPending = true;
    requestAnimationFrame(() => {
      renderer.rafPending = false;
      layoutCardEffects(renderer);
    });
  }

  function resizeCardRenderer(renderer) {
    const width = Math.max(1, renderer.mount.clientWidth);
    const height = Math.max(1, renderer.mount.clientHeight);
    if (renderer.app.renderer.width !== width || renderer.app.renderer.height !== height) {
      renderer.app.renderer.resize(width, height);
    }
    renderer.app.canvas.style.width = `${width}px`;
    renderer.app.canvas.style.height = `${height}px`;
  }

  function layoutCardEffects(renderer) {
    resizeCardRenderer(renderer);
    const canvasWidth = Math.max(1, renderer.canvas.width || 953);
    const canvasHeight = Math.max(1, renderer.canvas.height || 624);
    const scaleX = renderer.mount.clientWidth / canvasWidth;
    const scaleY = renderer.mount.clientHeight / canvasHeight;

    renderer.records.forEach((record) => {
      const slot = record.slot;
      if (!slot) return;
      const width = slot.width * scaleX;
      const height = slot.height * scaleY;
      const x = slot.x * scaleX;
      const y = slot.y * scaleY;
      const visualPad = Math.max(22, Math.min(72, Math.max(width, height) * (slot.kind === "favorite" ? 0.44 : 0.52)));
      record.slotX = x;
      record.slotY = y;
      record.slotWidth = width;
      record.slotHeight = height;
      record.visualPad = visualPad;
      record.scale = Math.min(scaleX, scaleY);
      record.container.position.set(x - visualPad, y - visualPad);
      record.container.visible = width > 0 && height > 0;
      setCardImageCorners(record);
      updateCardRecordEffects(record);
    });
  }

  function setCardImageCorners(record) {
    if (!record.mesh) return;
    const hover = reducedMotion() ? 0 : record.hover;
    const width = record.slotWidth;
    const height = record.slotHeight;
    const pad = record.visualPad;
    const size = Math.max(12, Math.min(width, height) * (1.0 + hover * 0.055));
    const centerX = pad + width / 2 + (record.x - 0.5) * width * 0.05 * hover;
    const centerY = pad + height / 2 + (record.y - 0.5) * height * 0.04 * hover;
    const yaw = (record.x - 0.5) * 0.96 * hover;
    const pitch = -(record.y - 0.5) * 0.78 * hover;
    const lift = Math.max(1.2, size * 0.025) * hover;

    applyProjectedCorners(record.auraMesh, centerX, centerY, size * 1.28, size * 1.28, yaw * 1.04, pitch * 1.04, lift * 0.35);
    applyProjectedCorners(record.rimMesh, centerX, centerY, size * 1.12, size * 1.12, yaw * 1.02, pitch * 1.02, lift * 0.5);
    applyProjectedCorners(record.mesh, centerX, centerY, size, size, yaw, pitch, lift);
    applyProjectedCorners(record.fxMesh, centerX, centerY, size, size, yaw, pitch, lift);
  }

  function updateCardRecordEffects(record) {
    const hover = reducedMotion() ? 0 : record.hover;
    const idle = reducedMotion() ? 0 : record.baseHover;
    const glowLevel = Math.max(hover, idle);

    if (record.auraMesh) {
      record.auraMesh.tint = record.color;
      record.auraMesh.alpha = 0.018 + glowLevel * 0.09;
    }
    if (record.rimMesh) {
      record.rimMesh.tint = record.color;
      record.rimMesh.alpha = 0.035 + glowLevel * 0.085;
    }
    if (record.fxMesh) {
      record.fxMesh.alpha = 0.24 + glowLevel * 0.22;
    }
    if (record.mesh) {
      record.mesh.alpha = 1;
    }

    updateLuxeUniforms(record.luxeFilter, record, false);
  }

  function updateCardEffects(renderer, ticker) {
    if (!renderer) return;
    resizeCardRenderer(renderer);
    const delta = ticker.deltaTime;
    renderer.records.forEach((record) => {
      if (!reducedMotion()) {
        record.time += delta / 60;
        const pointerFollow = Math.min(1, delta * 0.36);
        const hoverFollow = Math.min(1, delta * 0.30);
        record.x += ((record.targetHover > 0 ? record.targetX : 0.5) - record.x) * pointerFollow;
        record.y += ((record.targetHover > 0 ? record.targetY : 0.5) - record.y) * pointerFollow;
        record.hover += (record.targetHover - record.hover) * hoverFollow;
      }
      updateCardRecordEffects(record);
      setCardImageCorners(record);
    });
  }

  function updateCardPointer(renderer, event) {
    const rect = renderer.mount.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let active = null;

    renderer.records.forEach((record) => {
      const inside =
        x >= record.slotX &&
        x <= record.slotX + record.slotWidth &&
        y >= record.slotY &&
        y <= record.slotY + record.slotHeight;
      if (inside) {
        active = record;
        record.targetX = Math.max(0, Math.min(1, (x - record.slotX) / record.slotWidth));
        record.targetY = Math.max(0, Math.min(1, (y - record.slotY) / record.slotHeight));
        record.targetHover = reducedMotion() ? 0 : 1;
      } else {
        record.targetHover = 0;
      }
    });

    renderer.pointerSlot = active;
  }

  function leaveCardPointer(renderer) {
    renderer.pointerSlot = null;
    renderer.records.forEach((record) => {
      record.targetX = 0.5;
      record.targetY = 0.5;
      record.targetHover = 0;
    });
  }

  function destroyCardRenderer(mount) {
    const renderer = cardRenderers.get(mount);
    if (!renderer) return;
    if (renderer.resizeObserver) renderer.resizeObserver.disconnect();
    renderer.mount.removeEventListener("pointermove", renderer.pointerMove);
    renderer.mount.removeEventListener("pointerleave", renderer.pointerLeave);
    renderer.records.forEach((record) => record.container.destroy({ children: true }));
    renderer.records.clear();
    renderer.app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
    cardRenderers.delete(mount);
  }

  function destroyGrid() {
    if (gridResizeObserver) gridResizeObserver.disconnect();
    if (gridElement && scrollHandler) gridElement.removeEventListener("scroll", scrollHandler);
    tiles.forEach((record) => record.container.destroy({ children: true }));
    tiles.clear();
    if (gridApp) {
      gridApp.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
    }
    gridApp = null;
    gridLayer = null;
    gridElement = null;
    gridResizeObserver = null;
    scrollHandler = null;
  }

  window.BadgePixiEffects = {
    syncGrid,
    updatePointer,
    leavePointer,
    renderDetail,
    syncCard,
    sampleBadgeGlow,
    getLocalBadgeImageUrl,
    destroyGrid,
    destroyCardRenderer,
  };
})();
