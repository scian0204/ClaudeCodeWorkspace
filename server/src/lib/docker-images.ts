import Docker from 'dockerode';

// Admin image management for the image-typed config settings (code-server / review sandbox).
// Uses the mounted docker socket. Pulling a `:latest` tag doubles as "update".
const docker = new Docker();

export interface ImageStatus {
  present: boolean;
  id?: string;
  size?: number;      // bytes
  created?: string;   // ISO
  dockerUnavailable?: boolean;
  error?: string;
}

export async function inspectImage(image: string): Promise<ImageStatus> {
  try {
    const info: any = await docker.getImage(image).inspect();
    return { present: true, id: String(info.Id || '').replace(/^sha256:/, '').slice(0, 12), size: info.Size, created: info.Created };
  } catch (e: any) {
    const status = e?.statusCode;
    // 404 = image simply not pulled yet; anything else (socket missing, daemon down) = unavailable
    if (status === 404 || /no such image|not found/i.test(String(e?.message || e))) return { present: false };
    return { present: false, dockerUnavailable: true, error: String(e?.message || e).slice(0, 200) };
  }
}

export async function pullImage(image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: any, stream: any) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e: any) => (e ? reject(e) : resolve()));
    });
  });
}
