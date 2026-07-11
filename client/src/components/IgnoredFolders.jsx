import React, { useState, useCallback, useRef } from 'react';
import './IgnoredFolders.css';

export default function IgnoredFolders({
  ignoredFolders,
  onAddIgnored,
  onRemoveIgnored,
  onPickIgnored
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef(null);

  const handleAdd = async () => {
    if (!newPath.trim()) return;
    const success = await onAddIgnored(newPath.trim());
    if (success) {
      setNewPath('');
      setShowAdd(false);
    }
  };

  const handlePickFolder = async () => {
    setPicking(true);
    try {
      await onPickIgnored();
      setShowAdd(false);
      setCollapsed(false); // auto-expand after adding
    } finally {
      setPicking(false);
    }
  };

  const toggleCollapse = (e) => {
    // Don't toggle when clicking the +/✕ button
    if (e.target.closest('.ft-add-btn')) return;
    setCollapsed(!collapsed);
    if (collapsed) {
      setShowAdd(false);
    }
  };

  // Drag & drop zone
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(c => c + 1);
    if (e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
      setDragOver(true);
      setCollapsed(false); // auto-expand on drag
    }
  }, []);

  const handleDragOverZone = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(c => {
      const next = c - 1;
      if (next <= 0) {
        setDragOver(false);
        return 0;
      }
      return next;
    });
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    setDragCounter(0);

    const items = e.dataTransfer.items;
    if (!items) return;

    const addedPaths = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry && entry.isDirectory) {
          const path = await resolveEntryPath(entry);
          if (path) {
            const success = await onAddIgnored(path);
            if (success) addedPaths.push(path);
          }
        } else {
          const file = item.getAsFile();
          if (file && file.path) {
            const dirPath = await getDirectoryFromFile(file);
            if (dirPath && !addedPaths.includes(dirPath)) {
              const success = await onAddIgnored(dirPath);
              if (success) addedPaths.push(dirPath);
            }
          }
        }
      }
    }

    // Fallback: text/uri-list
    if (addedPaths.length === 0) {
      const uriData = e.dataTransfer.getData('text/uri-list');
      if (uriData) {
        const uris = uriData.split('\n').filter(u => u.trim());
        for (const uri of uris) {
          try {
            let decoded = decodeURI(uri.trim());
            if (decoded.startsWith('file://')) {
              decoded = decoded.replace(/^file:\/\/\//, '');
            }
            const success = await onAddIgnored(decoded);
            if (success) addedPaths.push(decoded);
          } catch (_) { /* skip */ }
        }
      }
    }
  }, [onAddIgnored]);

  const count = ignoredFolders.length;

  return (
    <div className={`ft-section ignored-section${collapsed ? ' collapsed' : ''}`}>
      <div className="ft-section-header ignored-header" onClick={toggleCollapse}>
        <span className="ignored-toggle">{collapsed ? '▶' : '▼'}</span>
        <span>🚫 Ignored{count > 0 && ` (${count})`}</span>
        <button
          className="ft-add-btn"
          onClick={() => { setCollapsed(false); setShowAdd(!showAdd); }}
          title="Add path to ignore"
        >
          {showAdd ? '✕' : '+'}
        </button>
      </div>

      {!collapsed && (
        <>
          {showAdd && (
            <div className="ft-add-form">
              <input
                ref={inputRef}
                type="text"
                placeholder="D:\\path\\to\\ignore"
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                autoFocus
              />
              <button onClick={handleAdd}>Add</button>
              <button
                className="ft-browse-btn"
                onClick={handlePickFolder}
                disabled={picking}
                title="Open folder picker"
              >
                {picking ? '...' : '📁'}
              </button>
            </div>
          )}

          <div
            className={`ignored-drop-zone${dragOver ? ' drag-over' : ''}${ignoredFolders.length === 0 ? ' empty' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOverZone}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {ignoredFolders.length === 0 ? (
              <div className="ignored-empty-hint">
                {dragOver ? '📂 Drop to ignore' : 'Drag folders here or click +'}
              </div>
            ) : (
              <div className="ft-list">
                {ignoredFolders.map(folder => (
                  <div
                    key={folder.id}
                    className={`ft-item ignored-item${!folder.exists ? ' missing' : ''}`}
                    title={`${folder.path}${!folder.exists ? ' (not found)' : ''}`}
                  >
                    <div className="ft-item-name">
                      {!folder.exists ? '⚠️ ' : '🚫 '}
                      <span className="ignored-name">{folder.name}</span>
                      <span className="ignored-path">{folder.path}</span>
                    </div>
                    <button
                      className="ft-remove-btn"
                      onClick={() => onRemoveIgnored(folder.id)}
                      title="Remove from ignore list"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Resolve a FileSystemDirectoryEntry to a full path
async function resolveEntryPath(entry) {
  return new Promise((resolve) => {
    if (entry.filesystem && entry.filesystem.root) {
      entry.getMetadata(() => {}, () => {});
    }
    if (typeof entry.getFullPath === 'function') {
      resolve(entry.getFullPath());
      return;
    }
    const url = entry.toURL ? entry.toURL() : '';
    if (url && url.startsWith('file://')) {
      resolve(decodeURI(url.replace(/^file:\/\/\//, '')));
      return;
    }
    resolve(entry.fullPath || '');
  });
}

// When a file is dropped, extract its parent directory path
async function getDirectoryFromFile(file) {
  if (file.path) {
    const sep = file.path.includes('\\') ? '\\' : '/';
    const lastSep = file.path.lastIndexOf(sep);
    return lastSep > 0 ? file.path.substring(0, lastSep) : file.path;
  }
  return null;
}
