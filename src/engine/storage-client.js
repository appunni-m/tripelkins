// IndexedDB and save codecs live with the authoritative worker. File pickers
// and user-gesture storage permission remain browser presentation adapters.
export function createStorageClient(engine) {
  return {
    saveWorld: () => engine.storage('save'),
    checkpointWorld: () => engine.storage('checkpoint'),
    replaceWorld: (_world,next,source,origin) => engine.replace(next,source,origin),
    listRecoveryWorlds: () => engine.storage('recoveries'),
    listHistoryMoments: () => engine.storage('history'),
    recoverMoment: (branch,id) => engine.storage('recover',{branch,id}),
    estimateStorage: () => engine.storage('estimate'),
    persistStorage: () => navigator.storage?.persist?.() ?? Promise.resolve(false),
    async downloadSave() {
      const world=await engine.storage('export');
      const url=URL.createObjectURL(new Blob([JSON.stringify({app:'Tripelkins',exportedAt:new Date().toISOString(),world},null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`tripelkins-${new Date().toISOString().slice(0,10)}.json`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    },
    async importSaveFile(file) {
      if(!file || file.size>16*1024*1024)throw new Error('Choose a world JSON smaller than 16 MB.');
      const raw=JSON.parse(await file.text());
      return engine.storage('import',{world:raw.world||raw});
    },
  };
}
