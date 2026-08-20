import express from 'express';
import { Link } from '../models/Link.js';
import { Content } from '../models/Content.js';
import { storageService } from '../services/storage.service.js';

const router = express.Router();

// Helper to escape HTML characters safely
function escapeHTML(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

router.get('/l/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    // 1. Find Link
    const link = await Link.findOne({ token });

    // 2. Validate existence and status
    const isValid = link && link.status === 'active';
    const isExpired = false; // Backward compatibility check if needed, but not used now
    
    if (!isValid) {
      res.status(isExpired ? 410 : 404);
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Link Expired</title>
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap" rel="stylesheet">
          <style>
            :root {
              --bg: #0b0f19;
              --card: #151c2c;
              --text: #f3f4f6;
              --text-dim: #9ca3af;
              --primary: #f59e0b;
            }
            body {
              background: var(--bg);
              color: var(--text);
              font-family: 'Outfit', sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 1.5rem;
              box-sizing: border-box;
            }
            .card {
              background: var(--card);
              border: 1px solid rgba(255, 255, 255, 0.08);
              padding: 2.5rem 2rem;
              border-radius: 1.5rem;
              text-align: center;
              max-width: 400px;
              width: 100%;
              box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
            }
            .icon {
              font-size: 3rem;
              margin-bottom: 1rem;
            }
            h1 {
              font-size: 1.5rem;
              margin: 0 0 0.5rem 0;
              font-weight: 600;
            }
            p {
              color: var(--text-dim);
              font-size: 0.95rem;
              margin: 0;
              line-height: 1.5;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">⏱️</div>
            <h1>Link Expired</h1>
            <p>This link is no longer available.</p>
          </div>
        </body>
        </html>
      `);
    }

    // 3. Load associated items and resolve presigned URLs
    const renderedItems = [];
    // Sort items by sortOrder
    const items = [...link.items].sort((a, b) => a.sortOrder - b.sortOrder);

    for (const item of items) {
      if (item.type === 'text') {
        renderedItems.push({
          type: 'text',
          text: item.text
        });
      } else if (item.mediaId) {
        const media = await Content.findById(item.mediaId);
        if (media && media.storageKey) {
          // Generate short-lived presigned URL (15 minutes = 900 seconds)
          const presignedUrl = await storageService.generatePresignedDownloadUrl(media.storageKey, 900);
          renderedItems.push({
            type: item.type,
            url: presignedUrl,
            caption: item.caption || media.caption || ''
          });
        }
      }
    }

    // 4. Render Media Collection page
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Shared Collection</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg: #0b0f19;
            --card: #151c2c;
            --border: rgba(255, 255, 255, 0.08);
            --text: #f3f4f6;
            --text-dim: #9ca3af;
            --primary: #f59e0b;
          }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: 'Outfit', sans-serif;
            margin: 0;
            padding: 2rem 1rem;
            display: flex;
            justify-content: center;
          }
          .container {
            max-width: 600px;
            width: 100%;
          }
          .header {
            margin-bottom: 2rem;
            text-align: center;
          }
          .header h1 {
            font-size: 1.8rem;
            font-weight: 600;
            margin: 0 0 0.5rem 0;
            background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .header p {
            color: var(--text-dim);
            font-size: 0.9rem;
            margin: 0;
          }
          .item-card {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 1.25rem;
            padding: 1.25rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 4px 20px -2px rgba(0,0,0,0.2);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
          }
          .media-container {
            position: relative;
            border-radius: 0.75rem;
            overflow: hidden;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          img, video {
            width: 100%;
            height: auto;
            max-height: 500px;
            object-fit: contain;
            display: block;
          }
          .caption {
            font-size: 0.95rem;
            color: var(--text);
            line-height: 1.5;
            white-space: pre-wrap;
            margin: 0;
          }
          .text-message {
            font-size: 1rem;
            color: var(--text);
            line-height: 1.6;
            white-space: pre-wrap;
            margin: 0;
            padding: 0.5rem 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Shared Collection</h1>
            <p>Generated by Administrator</p>
          </div>
          <div class="content-list">
            ${renderedItems.map(item => {
              if (item.type === 'text') {
                return `
                  <div class="item-card">
                    <p class="text-message">${escapeHTML(item.text)}</p>
                  </div>
                `;
              } else if (item.type === 'photo') {
                return `
                  <div class="item-card">
                    <div class="media-container">
                      <img src="${item.url}" alt="Collection Image" loading="lazy" />
                    </div>
                    ${item.caption ? `<p class="caption">${escapeHTML(item.caption)}</p>` : ''}
                  </div>
                `;
              } else if (item.type === 'video') {
                return `
                  <div class="item-card">
                    <div class="media-container">
                      <video controls preload="metadata">
                        <source src="${item.url}" type="video/mp4">
                        Your browser does not support the video tag.
                      </video>
                    </div>
                    ${item.caption ? `<p class="caption">${escapeHTML(item.caption)}</p>` : ''}
                  </div>
                `;
              } else if (item.type === 'document') {
                return `
                  <div class="item-card">
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                      <span style="font-size:1.5rem">📄</span>
                      <a href="${item.url}" target="_blank" style="color:var(--primary);text-decoration:none;font-weight:500;">Download Attachment</a>
                    </div>
                    ${item.caption ? `<p class="caption">${escapeHTML(item.caption)}</p>` : ''}
                  </div>
                `;
              }
              return '';
            }).join('')}
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    next(error);
  }
});

export default router;
