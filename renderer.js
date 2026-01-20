let folderA = null;
let folderB = null;
let comparisonData = [];
let collapsedDirs = new Set();

// Settings
let settings = {
  ignoreLineBreaks: true,
  useGitignore: true,
  hideMatches: false,
  ignorePatterns: []
};

// Load settings from localStorage
function loadSettings() {
  try {
    const saved = localStorage.getItem('folderDiffSettings');
    if (saved) {
      const parsed = JSON.parse(saved);
      settings = { ...settings, ...parsed };
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// Save settings to localStorage
function saveSettings() {
  try {
    localStorage.setItem('folderDiffSettings', JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

loadSettings();

const selectABtn = document.getElementById('select-a');
const selectBBtn = document.getElementById('select-b');
const pathAEl = document.getElementById('path-a');
const pathBEl = document.getElementById('path-b');
const compareBtn = document.getElementById('compare-btn');
const treeContainer = document.getElementById('tree-container');
const diffContainer = document.getElementById('diff-container');
const diffTitle = document.getElementById('diff-title');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const settingsSave = document.getElementById('settings-save');
const settingIgnoreLinebreaks = document.getElementById('setting-ignore-linebreaks');
const settingUseGitignore = document.getElementById('setting-use-gitignore');
const settingHideMatches = document.getElementById('setting-hide-matches');
const settingIgnorePatterns = document.getElementById('setting-ignore-patterns');

// Settings modal
settingsBtn.addEventListener('click', () => {
  // Populate form with current settings
  settingIgnoreLinebreaks.checked = settings.ignoreLineBreaks;
  settingUseGitignore.checked = settings.useGitignore;
  settingHideMatches.checked = settings.hideMatches;
  settingIgnorePatterns.value = settings.ignorePatterns.join('\n');
  
  settingsModal.classList.add('visible');
});

settingsClose.addEventListener('click', () => {
  settingsModal.classList.remove('visible');
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove('visible');
  }
});

settingsSave.addEventListener('click', () => {
  settings.ignoreLineBreaks = settingIgnoreLinebreaks.checked;
  settings.useGitignore = settingUseGitignore.checked;
  settings.hideMatches = settingHideMatches.checked;
  settings.ignorePatterns = settingIgnorePatterns.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  
  saveSettings();
  settingsModal.classList.remove('visible');
});

// Folder selection
selectABtn.addEventListener('click', async () => {
  const path = await window.electronAPI.selectFolder();
  if (path) {
    folderA = path;
    pathAEl.textContent = path;
    selectABtn.classList.add('selected');
    updateCompareButton();
  }
});

selectBBtn.addEventListener('click', async () => {
  const path = await window.electronAPI.selectFolder();
  if (path) {
    folderB = path;
    pathBEl.textContent = path;
    selectBBtn.classList.add('selected');
    updateCompareButton();
  }
});

function updateCompareButton() {
  compareBtn.disabled = !(folderA && folderB);
}

// Compare folders
compareBtn.addEventListener('click', async () => {
  if (!folderA || !folderB) return;
  
  treeContainer.innerHTML = '<div class="loading">Comparing folders...</div>';
  diffContainer.innerHTML = '<div class="empty-state">Click a file with differences to view</div>';
  collapsedDirs.clear();
  
  try {
    comparisonData = await window.electronAPI.compareFolders(folderA, folderB, {
      ignoreLineBreaks: settings.ignoreLineBreaks,
      ignorePatterns: settings.ignorePatterns,
      useGitignore: settings.useGitignore
    });
    renderTree();
  } catch (err) {
    treeContainer.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
  }
});

// Build tree structure from flat comparison data
function buildTree(data) {
  const root = { name: '', children: {}, isFile: false, data: null };
  
  for (const item of data) {
    const parts = item.path.split(/[/\\]/);
    let current = root;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');
      
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: currentPath,
          children: {},
          isFile: false,
          data: null
        };
      }
      
      if (isLast) {
        current.children[part].data = item;
        current.children[part].isFile = item.type === 'file';
      }
      
      current = current.children[part];
    }
  }
  
  return root;
}

// Render tree
function renderTree() {
  // Filter out matches if hideMatches is enabled
  const filteredData = settings.hideMatches 
    ? comparisonData.filter(item => item.status !== 'match')
    : comparisonData;
  
  const tree = buildTree(filteredData);
  
  // Calculate stats
  const stats = {
    onlyA: comparisonData.filter(i => i.status === 'only-a' && i.type === 'file').length,
    onlyB: comparisonData.filter(i => i.status === 'only-b' && i.type === 'file').length,
    different: comparisonData.filter(i => i.status === 'different').length,
    match: comparisonData.filter(i => i.status === 'match' && i.type === 'file').length
  };
  
  let html = `
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-dot only-a"></span>
        <span class="stat-count">${stats.onlyA}</span>
        <span class="stat-label">only in A</span>
      </div>
      <div class="stat-item">
        <span class="stat-dot only-b"></span>
        <span class="stat-count">${stats.onlyB}</span>
        <span class="stat-label">only in B</span>
      </div>
      <div class="stat-item">
        <span class="stat-dot different"></span>
        <span class="stat-count">${stats.different}</span>
        <span class="stat-label">different</span>
      </div>
      <div class="stat-item">
        <span class="stat-dot match"></span>
        <span class="stat-count">${stats.match}</span>
        <span class="stat-label">match</span>
      </div>
    </div>
  `;
  
  html += '<div class="tree-items">';
  html += renderTreeNode(tree, 0);
  html += '</div>';
  treeContainer.innerHTML = html;
  
  // Add click handlers for files
  treeContainer.querySelectorAll('.tree-item[data-type="file"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handleFileClick(el);
    });
  });
  
  // Add click handlers for directories (toggle collapse)
  treeContainer.querySelectorAll('.tree-item[data-type="directory"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDirClick(el);
    });
  });
}

function renderTreeNode(node, depth) {
  let html = '';
  
  const entries = Object.entries(node.children).sort((a, b) => {
    // Directories first, then files
    const aIsDir = !a[1].isFile;
    const bIsDir = !b[1].isFile;
    if (aIsDir !== bIsDir) return bIsDir ? 1 : -1;
    return a[0].localeCompare(b[0]);
  });
  
  for (const [name, child] of entries) {
    const status = child.data?.status || 'match';
    const isFile = child.isFile;
    const isCollapsed = collapsedDirs.has(child.path);
    const hasChildren = Object.keys(child.children).length > 0;
    const icon = isFile ? '◇' : (isCollapsed ? '▸' : '▾');
    
    html += `
      <div class="tree-item ${status}" 
           data-path="${child.path}" 
           data-type="${isFile ? 'file' : 'directory'}"
           data-status="${status}">
        ${Array(depth).fill('<span class="tree-indent"></span>').join('')}
        <span class="tree-icon ${isFile ? '' : 'folder-icon'}">${icon}</span>
        <span class="tree-name">${escapeHtml(name)}</span>
      </div>
    `;
    
    if (!isFile && hasChildren && !isCollapsed) {
      html += renderTreeNode(child, depth + 1);
    }
  }
  
  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle directory click (toggle collapse)
function handleDirClick(el) {
  const path = el.dataset.path;
  
  if (collapsedDirs.has(path)) {
    collapsedDirs.delete(path);
  } else {
    collapsedDirs.add(path);
  }
  
  renderTree();
}

// Handle file click
async function handleFileClick(el) {
  const path = el.dataset.path;
  const status = el.dataset.status;
  
  // Update selection
  treeContainer.querySelectorAll('.tree-item').forEach(item => {
    item.classList.remove('selected');
  });
  el.classList.add('selected');
  
  if (status === 'match') {
    diffContainer.innerHTML = '<div class="empty-state">Files are identical</div>';
    return;
  }
  
  diffTitle.textContent = path;
  diffContainer.innerHTML = '<div class="loading">Loading file contents...</div>';
  
  try {
    if (status === 'only-a') {
      const contentA = await window.electronAPI.getFileContent(`${folderA}/${path}`);
      renderSingleFile(path, contentA, 'only-a', 'A');
    } else if (status === 'only-b') {
      const contentB = await window.electronAPI.getFileContent(`${folderB}/${path}`);
      renderSingleFile(path, contentB, 'only-b', 'B');
    } else if (status === 'different') {
      const [contentA, contentB] = await Promise.all([
        window.electronAPI.getFileContent(`${folderA}/${path}`),
        window.electronAPI.getFileContent(`${folderB}/${path}`)
      ]);
      renderDiff(path, contentA, contentB);
    }
  } catch (err) {
    diffContainer.innerHTML = `<div class="empty-state">Error loading file: ${err.message}</div>`;
  }
}

// Render single file (only in A or B)
function renderSingleFile(path, content, status, label) {
  if (content === null) {
    diffContainer.innerHTML = '<div class="empty-state">Unable to read file (may be binary)</div>';
    return;
  }
  
  const lines = content.split('\n');
  
  let html = `
    <div class="single-file-view">
      <div class="single-file-header">
        <span class="single-file-label ${status}">Only in ${label}</span>
        <span class="single-file-path">${escapeHtml(path)}</span>
      </div>
      <div class="single-file-content">
  `;
  
  lines.forEach((line, i) => {
    html += `
      <div class="file-line">
        <span class="file-line-number">${i + 1}</span>
        <span class="file-line-content">${escapeHtml(line)}</span>
      </div>
    `;
  });
  
  html += '</div></div>';
  diffContainer.innerHTML = html;
}

// Simple diff algorithm
function computeDiff(linesA, linesB) {
  const result = [];
  let i = 0, j = 0;
  
  // Simple LCS-based diff
  const lcs = computeLCS(linesA, linesB);
  let lcsIdx = 0;
  
  while (i < linesA.length || j < linesB.length) {
    if (lcsIdx < lcs.length && i < linesA.length && linesA[i] === lcs[lcsIdx]) {
      // Check if B also matches
      if (j < linesB.length && linesB[j] === lcs[lcsIdx]) {
        result.push({ type: 'same', lineA: i + 1, lineB: j + 1, content: linesA[i] });
        i++;
        j++;
        lcsIdx++;
      } else {
        // B has extra line
        result.push({ type: 'added', lineB: j + 1, content: linesB[j] });
        j++;
      }
    } else if (lcsIdx < lcs.length && j < linesB.length && linesB[j] === lcs[lcsIdx]) {
      // A has extra line
      result.push({ type: 'removed', lineA: i + 1, content: linesA[i] });
      i++;
    } else if (i < linesA.length && (lcsIdx >= lcs.length || linesA[i] !== lcs[lcsIdx])) {
      result.push({ type: 'removed', lineA: i + 1, content: linesA[i] });
      i++;
    } else if (j < linesB.length) {
      result.push({ type: 'added', lineB: j + 1, content: linesB[j] });
      j++;
    }
  }
  
  return result;
}

function computeLCS(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to find LCS
  const lcs = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return lcs;
}

// Track current change index for navigation
let currentChangeIndex = -1;
let changeElements = [];

// Render diff view
function renderDiff(path, contentA, contentB) {
  if (contentA === null || contentB === null) {
    diffContainer.innerHTML = '<div class="empty-state">Unable to read file (may be binary)</div>';
    return;
  }
  
  const linesA = contentA.split('\n');
  const linesB = contentB.split('\n');
  const diff = computeDiff(linesA, linesB);
  
  // Count changes
  const changeCount = diff.filter(line => line.type !== 'same').length;
  
  let html = `
    <div class="diff-view">
      <div class="diff-header">
        <div class="diff-header-paths">
          <div class="diff-header-item">
            <span class="diff-header-label a">A</span>
            <span class="diff-header-path">${escapeHtml(folderA)}/${escapeHtml(path)}</span>
          </div>
          <div class="diff-header-item">
            <span class="diff-header-label b">B</span>
            <span class="diff-header-path">${escapeHtml(folderB)}/${escapeHtml(path)}</span>
          </div>
        </div>
        <div class="diff-nav">
          <span class="diff-nav-count"><span id="current-change">0</span> / ${changeCount}</span>
          <button class="diff-nav-btn" id="prev-change" title="Previous change (↑)">↑</button>
          <button class="diff-nav-btn" id="next-change" title="Next change (↓)">↓</button>
        </div>
      </div>
      <div class="diff-content" id="diff-content-scroll">
  `;
  
  let changeIdx = 0;
  for (const line of diff) {
    const lineNum = line.type === 'added' ? line.lineB : (line.lineA || '');
    const cssClass = line.type === 'same' ? '' : line.type === 'added' ? 'added' : 'removed';
    const dataChangeIdx = line.type !== 'same' ? `data-change-idx="${changeIdx++}"` : '';
    
    html += `
      <div class="diff-line ${cssClass}" ${dataChangeIdx}>
        <span class="diff-line-number">${lineNum}</span>
        <span class="diff-line-content">${escapeHtml(line.content)}</span>
      </div>
    `;
  }
  
  html += '</div></div>';
  diffContainer.innerHTML = html;
  
  // Setup navigation
  currentChangeIndex = -1;
  changeElements = Array.from(diffContainer.querySelectorAll('.diff-line[data-change-idx]'));
  
  const prevBtn = document.getElementById('prev-change');
  const nextBtn = document.getElementById('next-change');
  
  prevBtn.addEventListener('click', () => navigateChange(-1));
  nextBtn.addEventListener('click', () => navigateChange(1));
  
  // Keyboard navigation
  diffContainer.addEventListener('keydown', handleDiffKeydown);
  diffContainer.setAttribute('tabindex', '0');
}

function handleDiffKeydown(e) {
  if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault();
    navigateChange(-1);
  } else if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault();
    navigateChange(1);
  }
}

function navigateChange(direction) {
  if (changeElements.length === 0) return;
  
  // Remove highlight from current
  if (currentChangeIndex >= 0 && currentChangeIndex < changeElements.length) {
    changeElements[currentChangeIndex].classList.remove('highlighted');
  }
  
  // Calculate new index
  if (direction > 0) {
    currentChangeIndex = currentChangeIndex < changeElements.length - 1 ? currentChangeIndex + 1 : 0;
  } else {
    currentChangeIndex = currentChangeIndex > 0 ? currentChangeIndex - 1 : changeElements.length - 1;
  }
  
  // Highlight and scroll to new change
  const el = changeElements[currentChangeIndex];
  el.classList.add('highlighted');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  
  // Update counter
  const counter = document.getElementById('current-change');
  if (counter) {
    counter.textContent = currentChangeIndex + 1;
  }
}
