// Service Worker — proxy para YouTube sin CORS
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Solo interceptar peticiones a nuestro endpoint interno
  if (url.pathname === '/yt-info') {
    const videoId = url.searchParams.get('id');
    event.respondWith(fetchYouTubeInfo(videoId));
  }
});

async function fetchYouTubeInfo(videoId) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    // Fetch directo a YouTube desde el SW (IP del usuario, no datacenter)
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const html = await res.text();

    // Extraer ytInitialPlayerResponse
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*(?:;|\n)/s);
    if (!match) throw new Error('No se encontró player response');

    const player = JSON.parse(match[1]);
    const status = player?.playabilityStatus?.status;

    if (status !== 'OK') {
      throw new Error(`Video no disponible: ${player?.playabilityStatus?.reason || status}`);
    }

    const details = player.videoDetails;
    const formats = player.streamingData?.formats || [];
    const adaptive = player.streamingData?.adaptiveFormats || [];

    const videoStreams = adaptive
      .filter(f => f.mimeType?.startsWith('video/') && f.url && f.qualityLabel)
      .map(f => ({
        itag: f.itag,
        quality: f.qualityLabel,
        mime: f.mimeType.split(';')[0],
        fps: f.fps,
        height: f.height,
        bitrate: f.bitrate,
        url: f.url,
      }))
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    const audioStreams = adaptive
      .filter(f => f.mimeType?.startsWith('audio/') && f.url)
      .map(f => ({
        itag: f.itag,
        mime: f.mimeType.split(';')[0],
        bitrate: f.bitrate,
        url: f.url,
      }))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    const combined = formats
      .filter(f => f.url && f.qualityLabel)
      .map(f => ({
        itag: f.itag,
        quality: f.qualityLabel,
        mime: f.mimeType?.split(';')[0],
        url: f.url,
      }));

    const data = {
      id: videoId,
      title: details?.title || 'Sin título',
      author: details?.author || '',
      duration: parseInt(details?.lengthSeconds || 0),
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      videoStreams,
      audioStreams,
      combined,
    };

    return new Response(JSON.stringify(data), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: cors,
    });
  }
}