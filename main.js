const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Enable auto-reload in development
try {
  require('electron-reloader')(module);
} catch {}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

// Get file hash for comparison (with optional line break normalization)
function getFileHash(filePath, ignoreLineBreaks = false) {
  try {
    let content = fs.readFileSync(filePath);
    if (ignoreLineBreaks) {
      // Normalize line breaks to \n for comparison
      content = content.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      return crypto.createHash('md5').update(content).digest('hex');
    }
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (err) {
    return null;
  }
}

// Parse a .gitignore file and return patterns
function parseGitignore(gitignorePath) {
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (err) {
    return [];
  }
}

// Collect all .gitignore patterns from a directory recursively
function collectGitignorePatterns(dirPath, basePath = dirPath) {
  const patterns = [];
  
  function walk(currentPath) {
    try {
      const gitignorePath = path.join(currentPath, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        const relativeDirPath = path.relative(basePath, currentPath);
        const filePatterns = parseGitignore(gitignorePath);
        
        for (const pattern of filePatterns) {
          // Prefix patterns with the directory they came from
          if (relativeDirPath) {
            // Handle negation patterns
            if (pattern.startsWith('!')) {
              patterns.push('!' + path.join(relativeDirPath, pattern.slice(1)));
            } else {
              patterns.push(path.join(relativeDirPath, pattern));
            }
          } else {
            patterns.push(pattern);
          }
        }
      }
      
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory() && item !== '.git') {
            walk(fullPath);
          }
        } catch (err) {
          // Skip inaccessible items
        }
      }
    } catch (err) {
      // Skip inaccessible directories
    }
  }
  
  walk(dirPath);
  return patterns;
}

// Convert gitignore pattern to regex
function patternToRegex(pattern) {
  // Handle negation (we'll process these separately)
  const isNegation = pattern.startsWith('!');
  if (isNegation) {
    pattern = pattern.slice(1);
  }
  
  // Normalize path separators
  pattern = pattern.replace(/\\/g, '/');
  
  // Remove leading slash (anchors to root)
  const isAnchored = pattern.startsWith('/');
  if (isAnchored) {
    pattern = pattern.slice(1);
  }
  
  // Remove trailing slash (indicates directory)
  const isDirectory = pattern.endsWith('/');
  if (isDirectory) {
    pattern = pattern.slice(0, -1);
  }
  
  // Escape regex special chars except * and ?
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  
  // If not anchored and doesn't contain /, match anywhere
  if (!isAnchored && !pattern.includes('/')) {
    regex = '(^|.*/)'+ regex;
  } else {
    regex = '^' + regex;
  }
  
  // Match the path itself or anything under it
  regex = regex + '($|/.*)';
  
  return { regex: new RegExp(regex), isNegation, isDirectory };
}

// Check if a path matches any ignore pattern
function shouldIgnore(relativePath, patterns) {
  // Normalize path separators
  relativePath = relativePath.replace(/\\/g, '/');
  
  let ignored = false;
  
  for (const pattern of patterns) {
    const { regex, isNegation } = patternToRegex(pattern);
    
    if (regex.test(relativePath)) {
      ignored = !isNegation;
    }
  }
  
  return ignored;
}

// Read directory recursively and return flat list of paths
function readDirFlat(dirPath, basePath = dirPath, ignorePatterns = [], ignoreLineBreaks = false) {
  const result = {};
  
  function walk(currentPath) {
    try {
      const items = fs.readdirSync(currentPath);
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const relativePath = path.relative(basePath, fullPath);
        
        // Check if should be ignored
        if (shouldIgnore(relativePath, ignorePatterns)) {
          continue;
        }
        
        try {
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            result[relativePath] = { type: 'directory' };
            walk(fullPath);
          } else {
            result[relativePath] = {
              type: 'file',
              hash: getFileHash(fullPath, ignoreLineBreaks),
              size: stat.size
            };
          }
        } catch (err) {
          // Skip inaccessible items
        }
      }
    } catch (err) {
      console.error('Error reading directory:', err);
    }
  }
  
  walk(dirPath);
  return result;
}

// Compare two folders
ipcMain.handle('compare-folders', async (event, folderA, folderB, settings = {}) => {
  const {
    ignoreLineBreaks = true,
    ignorePatterns = [],
    useGitignore = true
  } = settings;
  
  // Collect all ignore patterns
  let allPatterns = [...ignorePatterns];
  
  if (useGitignore) {
    const gitignorePatternsA = collectGitignorePatterns(folderA);
    const gitignorePatternsB = collectGitignorePatterns(folderB);
    allPatterns = [...allPatterns, ...gitignorePatternsA, ...gitignorePatternsB];
  }
  
  const flatA = readDirFlat(folderA, folderA, allPatterns, ignoreLineBreaks);
  const flatB = readDirFlat(folderB, folderB, allPatterns, ignoreLineBreaks);
  
  const allKeys = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);
  
  const comparison = [];
  
  // First pass: determine status for files
  for (const key of allKeys) {
    const inA = key in flatA;
    const inB = key in flatB;
    const itemType = (inA ? flatA[key] : flatB[key]).type;
    
    let status;
    if (inA && !inB) {
      status = 'only-a';
    } else if (!inA && inB) {
      status = 'only-b';
    } else if (itemType === 'directory') {
      // Placeholder - will be computed based on children
      status = 'pending';
    } else if (flatA[key].hash === flatB[key].hash) {
      status = 'match';
    } else {
      status = 'different';
    }
    
    comparison.push({
      path: key,
      type: itemType,
      status,
      inA,
      inB
    });
  }
  
  // Sort by path (deeper paths first for bottom-up processing)
  comparison.sort((a, b) => b.path.localeCompare(a.path));
  
  // Second pass: compute directory statuses based on children
  const statusMap = new Map();
  for (const item of comparison) {
    statusMap.set(item.path, item.status);
  }
  
  for (const item of comparison) {
    if (item.type === 'directory' && item.status === 'pending') {
      // Find all direct and indirect children
      const childStatuses = new Set();
      for (const other of comparison) {
        if (other.path.startsWith(item.path + '/') || other.path.startsWith(item.path + '\\')) {
          childStatuses.add(statusMap.get(other.path));
        }
      }
      
      // Determine directory status based on children
      if (childStatuses.size === 0) {
        // Empty directory in both
        item.status = 'match';
      } else if (childStatuses.has('only-a') || childStatuses.has('only-b') || childStatuses.has('different')) {
        item.status = 'different';
      } else {
        item.status = 'match';
      }
      
      statusMap.set(item.path, item.status);
    }
  }
  
  // Re-sort by path (alphabetical for display)
  comparison.sort((a, b) => a.path.localeCompare(b.path));
  
  return comparison;
});

// Get file content for diff
ipcMain.handle('get-file-content', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content;
  } catch (err) {
    return null;
  }
});
