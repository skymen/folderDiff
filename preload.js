const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  compareFolders: (folderA, folderB, settings) => ipcRenderer.invoke('compare-folders', folderA, folderB, settings),
  getFileContent: (filePath) => ipcRenderer.invoke('get-file-content', filePath),
  computeDiff: (contentA, contentB, ignoreLineBreaks) => ipcRenderer.invoke('compute-diff', contentA, contentB, ignoreLineBreaks)
});
