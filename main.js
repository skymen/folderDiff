const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

// Get file hash for comparison
function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (err) {
    return null;
  }
}

// Read directory recursively and return flat list of paths
function readDirFlat(dirPath, basePath = dirPath) {
  const result = {};
  
  function walk(currentPath) {
    try {
      const items = fs.readdirSync(currentPath);
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const relativePath = path.relative(basePath, fullPath);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          result[relativePath] = { type: 'directory' };
          walk(fullPath);
        } else {
          result[relativePath] = {
            type: 'file',
            hash: getFileHash(fullPath),
            size: stat.size
          };
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
ipcMain.handle('compare-folders', async (event, folderA, folderB) => {
  const flatA = readDirFlat(folderA);
  const flatB = readDirFlat(folderB);
  
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
