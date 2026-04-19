import React, { useRef, useState } from 'react';

const MAX_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp'];

export default function ImageUploader({ onImagesSelected, isLoading = false }) {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [errors, setErrors] = useState([]);
  const fileInputRef = useRef(null);

  const validateFiles = (files) => {
    const newErrors = [];

    if (files.length > MAX_FILES) {
      newErrors.push(`Maximum ${MAX_FILES} images allowed. You selected ${files.length}.`);
    }

    Array.from(files).forEach((file, idx) => {
      if (!ACCEPTED_FORMATS.includes(file.type)) {
        newErrors.push(`File ${idx + 1}: ${file.name} - Only JPG, PNG, WebP allowed`);
      }

      if (file.size > MAX_FILE_SIZE) {
        newErrors.push(`File ${idx + 1}: ${file.name} - File too large (max 5MB)`);
      }
    });

    return newErrors;
  };

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (!files) return;

    const validationErrors = validateFiles(files);
    setErrors(validationErrors);

    if (validationErrors.length === 0) {
      const fileArray = Array.from(files).slice(0, MAX_FILES);
      setUploadedFiles(fileArray);
      onImagesSelected(fileArray);
    }
  };

  const handleRemoveFile = (index) => {
    const newFiles = uploadedFiles.filter((_, i) => i !== index);
    setUploadedFiles(newFiles);
    onImagesSelected(newFiles);
    setErrors([]);
  };

  const handleClearAll = () => {
    setUploadedFiles([]);
    setErrors([]);
    onImagesSelected([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div
        className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:border-blue-500 transition cursor-pointer bg-slate-700/20"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelect}
          className="hidden"
          disabled={isLoading}
        />

        <div className="space-y-2">
          <p className="text-3xl">Upload</p>
          <p className="text-white font-medium">Click to upload transaction images</p>
          <p className="text-slate-400 text-sm">
            JPG, PNG, or WebP - Max {MAX_FILES} images - 5MB each
          </p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-300 font-medium mb-2">Upload issues:</p>
          <ul className="space-y-1">
            {errors.map((error, idx) => (
              <li key={idx} className="text-sm text-red-200">
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <p className="text-white font-medium">
              {uploadedFiles.length} image{uploadedFiles.length !== 1 ? 's' : ''} selected
            </p>
            <button
              onClick={handleClearAll}
              className="text-sm text-slate-400 hover:text-slate-200 transition"
              disabled={isLoading}
            >
              Clear all
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {uploadedFiles.map((file, idx) => (
              <div key={idx} className="relative bg-slate-700 rounded-lg overflow-hidden group">
                <div className="aspect-video bg-slate-800 flex items-center justify-center text-2xl">
                  Preview
                </div>

                <div className="p-2 text-xs text-slate-400 truncate">{file.name}</div>

                {!isLoading && (
                  <button
                    onClick={() => handleRemoveFile(idx)}
                    className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 rounded-full w-6 h-6 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition"
                    title="Remove image"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadedFiles.length === 0 && errors.length === 0 && (
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3 text-sm text-blue-200">
          Tip: Capture screenshots of your transaction list. Multiple images from overlapping screens
          will be automatically deduplicated.
        </div>
      )}
    </div>
  );
}
