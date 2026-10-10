"""CPU FSRCNN inference with halo tiles, retained alpha, and bounded memory."""
import argparse
import os
from pathlib import Path

import cv2
import numpy as np


def upscale(input_path, output_path, scale, model_dir):
    cv2.setNumThreads(int(os.environ.get('UPSCALE_THREADS', '2')))
    source = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if source is None:
        raise ValueError('Cannot decode input image')
    if source.ndim == 2:
        source = cv2.cvtColor(source, cv2.COLOR_GRAY2BGR)
    height, width = source.shape[:2]
    if height * width * scale * scale > 80_000_000:
        raise ValueError('Output exceeds 80 megapixels')
    alpha = source[:, :, 3] if source.shape[2] == 4 else None
    color = source[:, :, :3]
    # Neural model expects unsigned 8-bit pixels.
    if color.dtype != np.uint8:
        raise ValueError('Expected normalized 8-bit image')
    sr = cv2.dnn_superres.DnnSuperResImpl_create()
    sr.readModel(str(Path(model_dir) / f'FSRCNN_x{scale}.pb'))
    sr.setModel('fsrcnn', scale)
    result = np.empty((height * scale, width * scale, 3), dtype=np.uint8)
    tile, halo = 256, 16
    for y in range(0, height, tile):
        for x in range(0, width, tile):
            x1, y1 = max(0, x - halo), max(0, y - halo)
            x2, y2 = min(width, x + tile + halo), min(height, y + tile + halo)
            out = sr.upsample(color[y1:y2, x1:x2])
            w, h = min(tile, width - x), min(tile, height - y)
            ox, oy = (x - x1) * scale, (y - y1) * scale
            result[y * scale:(y + h) * scale, x * scale:(x + w) * scale] = out[oy:oy + h * scale, ox:ox + w * scale]
    if alpha is not None:
        alpha = cv2.resize(alpha, (width * scale, height * scale), interpolation=cv2.INTER_CUBIC)
        result = np.dstack((result, alpha))
    if not cv2.imwrite(str(output_path), result):
        raise OSError('Cannot save result')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--scale', type=int, choices=[2, 4], required=True)
    parser.add_argument('--models', required=True)
    args = parser.parse_args()
    upscale(args.input, args.output, args.scale, args.models)
