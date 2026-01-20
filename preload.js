const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  compareFolders: (folderA, folderB) => ipcRenderer.invoke('compare-folders', folderA, folderB),
  getFileContent: (filePath) => ipcRenderer.invoke('get-file-content', filePath)
});
