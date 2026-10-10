"""Small reproducible quality experiment, not a general image-quality guarantee."""
import json
import tempfile
from pathlib import Path
from urllib.request import urlopen
import cv2
import numpy as np
from upscale import upscale

root = Path(__file__).resolve().parents[1]
url = 'https://raw.githubusercontent.com/Saafke/FSRCNN_Tensorflow/6a4812c4ef1c4f5947d79beafa32a05a6eb4a94d/images/original.png'
with urlopen(url, timeout=30) as response:
    source = cv2.imdecode(np.frombuffer(response.read(), np.uint8), cv2.IMREAD_COLOR)
h, w = source.shape[:2]
source = source[:h // 4 * 4, :w // 4 * 4]
results = []
with tempfile.TemporaryDirectory(prefix='stock-quality-') as folder:
    for scale in (2, 4):
        low = cv2.resize(source, (source.shape[1] // scale, source.shape[0] // scale), interpolation=cv2.INTER_CUBIC)
        input_file, output_file = Path(folder) / 'input.png', Path(folder) / 'result.png'
        cv2.imwrite(str(input_file), low)
        upscale(input_file, output_file, scale, root / '.data/models')
        result = cv2.imread(str(output_file))
        bicubic = cv2.resize(low, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_CUBIC)
        def luminance(image):
            return cv2.cvtColor(image, cv2.COLOR_BGR2YCrCb)[scale:-scale, scale:-scale, 0]
        results.append({'scale': scale, 'width': source.shape[1], 'height': source.shape[0], 'bicubic_psnr_y_db': round(cv2.PSNR(luminance(source), luminance(bicubic)), 3), 'fsrcnn_psnr_y_db': round(cv2.PSNR(luminance(source), luminance(result)), 3)})
print(json.dumps({'source': url, 'experiment': 'One reference image, synthetic bicubic degradation, border-cropped luminance PSNR', 'results': results}, indent=2))
