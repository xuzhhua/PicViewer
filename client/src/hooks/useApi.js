import { useState, useCallback, useEffect } from 'react';

function encodePath(filePath) {
  if (!filePath) return '';
  // Use base64url encoding for safe URL transmission
  const utf8Bytes = new TextEncoder().encode(filePath);
  const binary = String.fromCharCode(...utf8Bytes);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export default function useApi() {
  const [folders, setFolders] = useState([]);
  const [browseData, setBrowseData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch configured root folders
  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      setFolders(data);
    } catch (e) {
      console.error('Failed to fetch folders:', e);
    }
  }, []);

  // Browse a directory
  const browse = useCallback(async (folderPath, details = false) => {
    setLoading(true);
    setError(null);
    try {
      const encoded = encodePath(folderPath);
      const params = new URLSearchParams();
      if (encoded) params.set('path', encoded);
      if (details) params.set('details', '1');
      const qs = params.toString();
      const url = qs ? `/api/browse?${qs}` : '/api/browse';
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Browse failed');
      }
      const data = await res.json();
      setBrowseData(data);
    } catch (e) {
      setError(e.message);
      setBrowseData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Add a new root folder
  const addFolder = useCallback(async (folderPath) => {
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Add failed');
      }
      await fetchFolders();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }, [fetchFolders]);

  // Remove a root folder
  const removeFolder = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/folders/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      await fetchFolders();
      setBrowseData(null);
    } catch (e) {
      setError(e.message);
    }
  }, [fetchFolders]);

  // Get thumbnail URL
  const getThumbnailUrl = useCallback((filePath, size = 256, fit = 'cover') => {
    const encoded = encodePath(filePath);
    return `/api/image/thumbnail?path=${encoded}&size=${size}&fit=${fit}`;
  }, []);

  // Get original image URL
  const getImageUrl = useCallback((filePath) => {
    const encoded = encodePath(filePath);
    return `/api/image/view?path=${encoded}`;
  }, []);

  // Open native folder picker
  const pickFolder = useCallback(async () => {
    try {
      const res = await fetch('/api/folders/pick', { method: 'POST' });
      const data = await res.json();
      if (data.path) {
        const success = await addFolder(data.path);
        if (!success) return null;
        return data.path;
      }
      return null;
    } catch (e) {
      console.error('pickFolder error:', e);
      setError(e.message || 'Picker failed');
      return null;
    }
  }, [addFolder]);

  // Initialize
  useEffect(() => {
    fetchFolders();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    folders,
    browseData,
    loading,
    error,
    pickFolder,
    fetchFolders,
    browse,
    addFolder,
    removeFolder,
    getThumbnailUrl,
    getImageUrl
  };
}
