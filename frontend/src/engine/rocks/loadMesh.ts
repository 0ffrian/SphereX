// Issue #71, D-37 (stream V3): a shape model's triangles, relative to its bounding-box centre, for
// `radialHeights`. glTF or OBJ, the same loaders as the three.js viewer. Null when it has none.
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

export async function loadMeshTriangles(url: string): Promise<Float32Array | null> {
  const root: Object3D = /\.obj(\?|$)/i.test(url)
    ? await new OBJLoader().loadAsync(url)
    : (await new GLTFLoader().loadAsync(url)).scene;
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const c = box.getCenter(new Vector3());
  const out: number[] = [];
  const v = new Vector3();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const g = o.geometry;
    const pos = g.getAttribute('position');
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i)
        .applyMatrix4(o.matrixWorld)
        .sub(c);
      out.push(v.x, v.y, v.z);
    }
  });
  return out.length >= 9 ? new Float32Array(out) : null;
}
