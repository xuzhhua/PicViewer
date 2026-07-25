import React, { useState, useCallback, useRef, useMemo } from 'react';
import './FolderTree.css';

export default function FolderTree({
  folders,
  currentPath,
  browseData,
  onBrowse,
  onBackToRoot,
  onAddFolder,
  onRemoveFolder,
  onPickFolder,
  onReorderFolders
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dragOverId, setDragOverId] = useState(null);
  const dragIdRef = useRef(null);

  const handleAdd = async () => {
    if (!newPath.trim()) return;
    const success = await onAddFolder(newPath.trim());
    if (success) {
      setNewPath('');
      setShowAdd(false);
    }
  };

  const handleBrowse = async () => {
    setPicking(true);
    try {
      console.log('Browse clicked, calling onPickFolder...');
      await onPickFolder();
      setShowAdd(false);
    } finally {
      setPicking(false);
    }
  };

  // Drag and drop
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const items = e.dataTransfer.items;
    if (!items) return;

    let hasFiles = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') { hasFiles = true; break; }
    }

    if (hasFiles) {
      console.log('Drop detected with files, opening picker...');
      await onPickFolder();
    }
  }, [onPickFolder]);

  // Folder reorder drag handlers
  const handleFolderDragStart = useCallback((e, folderId) => {
    dragIdRef.current = folderId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', folderId);
  }, []);

  const handleFolderDragOver = useCallback((e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    if (folderId !== dragIdRef.current) {
      setDragOverId(folderId);
    }
  }, []);

  const handleFolderDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleFolderDrop = useCallback((e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    const dragId = dragIdRef.current;
    dragIdRef.current = null;
    setDragOverId(null);

    if (!dragId || dragId === targetId) return;

    const ids = folders.map(f => f.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);

    onReorderFolders?.(ids);
  }, [folders, onReorderFolders]);

  const handleFolderDragEnd = useCallback(() => {
    dragIdRef.current = null;
    setDragOverId(null);
  }, []);

  // Build full directory tree from root folders to current path
  const pathTree = useMemo(() => {
    if (!currentPath || !browseData) return null;

    const normalizedCurrent = currentPath.replace(/\\/g, '/').toLowerCase();
    // Find which root folder contains the current path
    const matchingRoot = folders.find(f => {
      const n = f.path.replace(/\\/g, '/').toLowerCase();
      return normalizedCurrent === n ||
        (normalizedCurrent.startsWith(n) && normalizedCurrent[n.length] === '/');
    });

    if (!matchingRoot) return null;

    const rootPath = matchingRoot.path.replace(/\\/g, '/');
    const currentNormalized = currentPath.replace(/\\/g, '/');
    let rel = currentNormalized.substring(rootPath.length);
    if (rel.startsWith('/')) rel = rel.substring(1);
    const parts = rel.split('/').filter(Boolean);

    // Build intermediate paths (root → ... → current)
    let accPath = rootPath;
    const pathParts = parts.map(part => {
      accPath += '/' + part;
      return { name: part, path: accPath };
    });

    return {
      root: matchingRoot,
      pathParts,
      subfolders: browseData.folders || [],
      mediaCount: (browseData.images?.length || 0) + (browseData.videos?.length || 0),
    };
  }, [currentPath, browseData, folders]);

  return (
    <div
      className={`folder-tree${dragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="ft-drop-overlay">
          <span><img src="/icons/folder-open.svg" alt="" width="18" height="18" style={{verticalAlign:'middle',marginRight:6}} /> Drop folder here</span>
        </div>
      )}

      <div className="ft-section">
        <div className="ft-section-header">
          <span>
                <img src="/icons/picture-folder.svg" alt="" width="16" height="16" style={{verticalAlign:'middle',marginRight:6}} /> My Folders
            {folders.length > 0 && <span className="ft-badge">{folders.length}</span>}
          </span>
          <button
            className="ft-add-btn"
            onClick={() => setShowAdd(!showAdd)}
            title="Add folder"
          >
            {showAdd ? '✕' : '+'}
          </button>
        </div>

        {showAdd && (
          <div className="ft-add-form">
            <input
              type="text"
              placeholder="Path: D:\\Photos or \\\\server\\share"
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              autoFocus
            />
            <button onClick={handleAdd}>Add</button>
            <button
              className="ft-browse-btn"
              onClick={handleBrowse}
              disabled={picking}
              title="浏览选择文件夹"
            >
              {picking ? <span className="spinner" style={{width:14,height:14,borderWidth:2}} /> : <img src="/icons/folder-add.svg" alt="" width="16" height="16" />}
            </button>
          </div>
        )}

        <div className="ft-list">
          {folders.length === 0 ? (
            <div className="ft-empty">Click + to add a folder</div>
          ) : (
            folders.map(folder => (
              <div
                key={folder.id}
                className={`ft-item ${currentPath === folder.path ? 'active' : ''}${dragOverId === folder.id ? ' drag-target' : ''}`}
                draggable
                onDragStart={(e) => handleFolderDragStart(e, folder.id)}
                onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                onDragLeave={handleFolderDragLeave}
                onDrop={(e) => handleFolderDrop(e, folder.id)}
                onDragEnd={handleFolderDragEnd}
              >
                <span className="ft-drag-handle" title="拖拽排序"><img src="/icons/drag.svg" alt="" width="12" height="12" /></span>
                <div
                  className="ft-item-name"
                  onClick={() => onBrowse(folder.path)}
                  title={folder.path}
                >
                  <span className="ft-icon"><img src="/icons/folder-open.svg" alt="" width="16" height="16" /></span> {folder.name}
                </div>
                <button
                  className="ft-remove-btn"
                  onClick={(e) => { e.stopPropagation(); onRemoveFolder(folder.id); }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Full directory tree: root → ... → current → subfolders */}
      {pathTree && (
        <div className="ft-section">
          <div className="ft-section-header">
            <span>
              <img src="/icons/folder-list.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:4}} />
              {pathTree.root.name}
            </span>
          </div>
          <div className="ft-list">
            {pathTree.pathParts.length === 0 ? (
              // Current path IS the root folder itself
              <>
                {pathTree.subfolders.length > 0 ? (
                  pathTree.subfolders.map(folder => (
                    <div
                      key={folder.path}
                      className="ft-item ft-sub"
                      onClick={() => onBrowse(folder.path)}
                      title={folder.path}
                    >
                      <span className="ft-icon"><img src="/icons/folder.svg" alt="" width="14" height="14" /></span>
                      {folder.name}
                    </div>
                  ))
                ) : (
                  <div className="ft-empty" style={{padding:'7px 12px',fontSize:12,color:'var(--text-muted)'}}>
                    {pathTree.mediaCount} file{pathTree.mediaCount !== 1 ? 's' : ''}
                  </div>
                )}
              </>
            ) : (
              // Current path is deeper than root → show full hierarchy
              pathTree.pathParts.map((part, i) => {
                const isLast = i === pathTree.pathParts.length - 1;
                return (
                  <React.Fragment key={part.path}>
                    <div
                      className={`ft-item ft-sub${isLast ? ' active' : ''}`}
                      onClick={() => onBrowse(part.path)}
                      title={part.path}
                    >
                      <span className="ft-icon">
                        <img src={isLast ? '/icons/folder-open.svg' : '/icons/folder.svg'} alt="" width="14" height="14" />
                      </span>
                      {part.name}
                    </div>
                    {isLast && (
                      <>
                        {pathTree.subfolders.length > 0 ? (
                          pathTree.subfolders.map(folder => (
                            <div
                              key={folder.path}
                              className="ft-item ft-sub"
                              onClick={() => onBrowse(folder.path)}
                              title={folder.path}
                            >
                              <span className="ft-icon"><img src="/icons/folder.svg" alt="" width="14" height="14" /></span>
                              {folder.name}
                            </div>
                          ))
                        ) : (
                          <div className="ft-empty" style={{padding:'7px 12px',fontSize:12,color:'var(--text-muted)'}}>
                            {pathTree.mediaCount} file{pathTree.mediaCount !== 1 ? 's' : ''}
                          </div>
                        )}
                      </>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
