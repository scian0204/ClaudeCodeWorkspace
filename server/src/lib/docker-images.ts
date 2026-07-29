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

// Dangling images = untagged leftover layers (`<none>:<none>`) from rebuilds/pulls. Never a tagged
// image the app references, so reporting/pruning them is always safe.
export async function listDanglingImages(): Promise<{ count: number; size: number; dockerUnavailable?: boolean }> {
  try {
    const imgs = await docker.listImages({ filters: { dangling: ['true'] } as any });
    return { count: imgs.length, size: imgs.reduce((a, i) => a + (i.Size || 0), 0) };
  } catch {
    return { count: 0, size: 0, dockerUnavailable: true };
  }
}

// Prune ONLY dangling images (the `dangling=true` filter guarantees tagged images are untouched).
export async function pruneDanglingImages(): Promise<{ removed: number; reclaimed: number; dockerUnavailable?: boolean }> {
  try {
    const res: any = await docker.pruneImages({ filters: { dangling: ['true'] } as any });
    const removed = (res?.ImagesDeleted || []).filter((d: any) => d?.Deleted).length;
    return { removed, reclaimed: res?.SpaceReclaimed || 0 };
  } catch {
    return { removed: 0, reclaimed: 0, dockerUnavailable: true };
  }
}
