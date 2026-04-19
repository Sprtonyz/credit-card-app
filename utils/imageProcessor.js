import Tesseract from 'tesseract.js';
import { correctTransaction } from './ocrErrorCorrection';

async function extractTextFromImage(imageFile, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const image = event.target.result;

        const {
          data: { text },
        } = await Tesseract.recognize(image, 'eng', {
          logger: (m) => {
            if (onProgress) {
              onProgress(m.progress);
            }
          },
        });

        resolve(text);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read image file'));
    };

    reader.readAsDataURL(imageFile);
  });
}

function parseTransactionText(text) {
  if (!text) return [];

  const transactions = [];
  const lines = text.split('\n').filter((line) => line.trim().length > 0);

  let currentMerchant = null;
  let currentAmount = null;
  let currentDate = null;
  let currentCategory = null;

  for (const line of lines) {
    const trimmed = line.trim();

    const amountMatch = trimmed.match(/\$?\d+[.,]\d{2}|\d+[.,]\d{2}/);
    if (amountMatch) {
      if (currentAmount && currentMerchant) {
        transactions.push({
          merchant: currentMerchant,
          amount: currentAmount,
          date: currentDate,
          category: currentCategory,
        });
        currentMerchant = null;
        currentDate = null;
        currentCategory = null;
      }
      currentAmount = amountMatch[0];
    }

    const dateMatch = trimmed.match(
      /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}/i
    );
    if (dateMatch) {
      currentDate = dateMatch[0];
    }

    if (!amountMatch && trimmed.length > 2 && !dateMatch) {
      currentMerchant = trimmed;
    }

    if (/entertainment|food|groceries|transport|shopping|utilities|health/i.test(trimmed)) {
      currentCategory = trimmed;
    }
  }

  if (currentAmount && currentMerchant) {
    transactions.push({
      merchant: currentMerchant,
      amount: currentAmount,
      date: currentDate,
      category: currentCategory,
    });
  }

  return transactions;
}

export async function generateImageHash(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const buffer = event.target.result;
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        resolve(hashHex);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file for hashing'));
    };

    reader.readAsArrayBuffer(file);
  });
}

export async function processImage(imageFile, onProgress) {
  try {
    const imageHash = await generateImageHash(imageFile);
    const extractedText = await extractTextFromImage(imageFile, onProgress);
    const rawTransactions = parseTransactionText(extractedText);
    const correctedTransactions = rawTransactions.map(correctTransaction);

    return {
      imageHash,
      fileName: imageFile.name,
      extractedText,
      transactions: correctedTransactions,
      originalCount: rawTransactions.length,
    };
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
}

export async function processImages(imageFiles, onProgress) {
  const results = [];

  for (let i = 0; i < imageFiles.length; i++) {
    try {
      const result = await processImage(imageFiles[i], (progress) => {
        const overallProgress = (i + progress) / imageFiles.length;
        if (onProgress) {
          onProgress({
            currentFile: i + 1,
            totalFiles: imageFiles.length,
            fileProgress: progress,
            overallProgress,
          });
        }
      });

      results.push(result);
    } catch (error) {
      console.error(`Error processing image ${i + 1}:`, error);
      results.push({
        imageHash: null,
        fileName: imageFiles[i].name,
        error: error.message,
        transactions: [],
      });
    }
  }

  return results;
}
