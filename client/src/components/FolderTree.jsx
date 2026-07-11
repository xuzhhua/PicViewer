import React, { useState, useCallback } from 'react';
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
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

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
    setDragId(folderId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', folderId);
  }, []);

  const handleFolderDragOver = useCallback((e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    if (folderId !== dragId) {
      setDragOverId(folderId);
    }
  }, [dragId]);

  const handleFolderDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleFolderDrop = useCallback((e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragId(null);
    setDragOverId(null);

    if (!dragId || dragId === targetId) return;

    const ids = folders.map(f => f.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    // Reorder: remove fromIdx, insert at toIdx
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);

    onReorderFolders?.(ids);
  }, [dragId, folders, onReorderFolders]);

  return (
    <div
      className={`folder-tree${dragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="ft-drop-overlay">
          <span>📂 Drop folder here</span>
        </div>
      )}

      <div className="ft-section">
        <div className="ft-section-header">
          <span>📂 My Folders</span>
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
            >
              {picking ? '...' : '📁'}
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
                onDragEnd={() => { setDragId(null); setDragOverId(null); }}
              >
                <span className="ft-drag-handle" title="拖拽排序">⋮⋮</span>
                <div
                  className="ft-item-name"
                  onClick={() => onBrowse(folder.path)}
                  title={folder.path}
                >
                  📁 {folder.name}
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

      {/* Subfolder tree for current directory */}
      {browseData && browseData.folders && browseData.folders.length > 0 && (
        <div className="ft-section">
          <div className="ft-section-header">
            <span>📁 {browseData.name || 'Subfolders'}</span>
          </div>
          <div className="ft-list">
            {currentPath && (
              <div className="ft-item ft-back" onClick={onBackToRoot}>
                <span>⬆ Back to root</span>
              </div>
            )}
            {browseData.folders.map(folder => (
              <div
                key={folder.path}
                className={`ft-item ${currentPath === folder.path ? 'active' : ''}`}
                onClick={() => onBrowse(folder.path)}
                title={folder.path}
              >
                📁 {folder.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
