// Tyro Camo Interactive Transformer & Demo Engine

document.addEventListener('DOMContentLoaded', () => {
  // Preset definitions
  const presets = {
    drm: {
      source: "resources/js/player-drm.js",
      standard: "assets/player-drm-C9x0a.js",
      codenames: [
        { codename: "swift-tiger", hash: "C9x0a" },
        { codename: "amber-harbor", hash: "7K2v1" },
        { codename: "silent-falcon", hash: "F4a8e" },
        { codename: "neon-panther", hash: "9M3b0" }
      ]
    },
    license: {
      source: "resources/js/license-validator.js",
      standard: "assets/license-validator-A1b2c.js",
      codenames: [
        { codename: "iron-beacon", hash: "A1b2c" },
        { codename: "cobalt-reef", hash: "3D1x9" },
        { codename: "quiet-spire", hash: "8B4f2" },
        { codename: "velvet-shield", hash: "6W9p4" }
      ]
    },
    fraud: {
      source: "resources/js/fraud-heuristics.js",
      standard: "assets/fraud-heuristics-E5g6h.js",
      codenames: [
        { codename: "coral-ridge", hash: "E5g6h" },
        { codename: "arctic-drift", hash: "1L9m7" },
        { codename: "silver-vortex", hash: "5Q8r3" },
        { codename: "shadow-prism", hash: "4P2z8" }
      ]
    }
  };

  let currentPresetKey = 'drm';
  let currentIndex = 0;

  // DOM Elements
  const bladePreview = document.getElementById('blade-preview');
  const standardOutput = document.getElementById('standard-output');
  const manifestPreview = document.getElementById('manifest-preview');
  const cloakedOutput = document.getElementById('cloaked-output');
  const seedName = document.getElementById('seed-name');
  const rerollBtn = document.getElementById('reroll-btn');
  const presetButtons = document.querySelectorAll('.preset-btn');

  function updateDisplay() {
    const data = presets[currentPresetKey];
    const item = data.codenames[currentIndex % data.codenames.length];

    bladePreview.textContent = `@vite('${data.source}')`;
    standardOutput.textContent = data.standard;
    
    manifestPreview.textContent = `"file": "assets/${item.codename}-${item.hash}.js"`;
    cloakedOutput.textContent = `<script src="/build/assets/${item.codename}-${item.hash}.js">`;
    seedName.textContent = `seed-${item.codename.split('-')[0]}-${item.hash}`;
  }

  // Preset switching
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPresetKey = btn.dataset.preset;
      currentIndex = 0;
      updateDisplay();
    });
  });

  // Re-roll button
  rerollBtn.addEventListener('click', () => {
    currentIndex++;
    rerollBtn.style.transform = 'scale(0.96)';
    setTimeout(() => {
      rerollBtn.style.transform = 'scale(1)';
    }, 150);
    updateDisplay();
  });

  // Copy install command
  const installBar = document.getElementById('install-trigger');
  const copyBtn = document.getElementById('copy-btn');
  const copyLabel = document.getElementById('copy-label');
  const cmdText = document.getElementById('install-cmd').innerText;

  function copyInstall() {
    navigator.clipboard.writeText(cmdText).then(() => {
      copyLabel.textContent = 'COPIED!';
      copyBtn.style.background = '#FFFFFF';
      copyBtn.style.color = '#000000';
      setTimeout(() => {
        copyLabel.textContent = 'COPY';
        copyBtn.style.background = '';
        copyBtn.style.color = '';
      }, 2000);
    });
  }

  if (installBar) installBar.addEventListener('click', copyInstall);

  // Copy CTA bar
  const ctaTrigger = document.getElementById('install-cta-trigger');
  if (ctaTrigger) {
    ctaTrigger.addEventListener('click', () => {
      navigator.clipboard.writeText('npm i vite-plugin-tyro-camo --save-dev');
      const textSpan = ctaTrigger.querySelector('.cmd-text');
      const original = textSpan.innerText;
      textSpan.innerText = 'Copied to clipboard!';
      textSpan.style.color = 'var(--laravel-red)';
      setTimeout(() => {
        textSpan.innerText = original;
        textSpan.style.color = '';
      }, 2000);
    });
  }

  // Copy config code
  const copyConfigBtn = document.getElementById('copy-config-btn');
  if (copyConfigBtn) {
    copyConfigBtn.addEventListener('click', () => {
      const code = document.getElementById('code-snippet').innerText;
      navigator.clipboard.writeText(code).then(() => {
        copyConfigBtn.textContent = 'Copied!';
        copyConfigBtn.style.background = '#FFFFFF';
        copyConfigBtn.style.color = '#000000';
        setTimeout(() => {
          copyConfigBtn.textContent = 'Copy Config';
          copyConfigBtn.style.background = '';
          copyConfigBtn.style.color = '';
        }, 2000);
      });
    });
  }

  // Initial render
  updateDisplay();
});
