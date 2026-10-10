"""Download pinned, checksum-verified FSRCNN weights. Never disables TLS."""
import hashlib
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
REVISION = '6a4812c4ef1c4f5947d79beafa32a05a6eb4a94d'
BASE = f'https://raw.githubusercontent.com/Saafke/FSRCNN_Tensorflow/{REVISION}'
WEIGHTS = {
    'FSRCNN_x2.pb': '366b33f0084c7b3f2bf6724f0a2c77bca94fcec9d7b6d72389d330073b380d5c',
    'FSRCNN_x4.pb': '5c68d18db561aed8ead4ffedf1b897ea615baaf60ebf6c35f8e641f8fa4a21bf',
}

if __name__ == '__main__':
    directory = ROOT / '.data' / 'models'
    directory.mkdir(parents=True, exist_ok=True)
    for filename, expected in WEIGHTS.items():
        destination = directory / filename
        if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
            print(f'{filename}: verified existing model')
            continue
        with urlopen(f'{BASE}/models/{filename}', timeout=60) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f'Checksum verification failed: {filename}')
        destination.write_bytes(data)
        print(f'{filename}: downloaded and verified')
    with urlopen(f'{BASE}/LICENSE', timeout=30) as response:
        (directory / 'LICENSE-FSRCNN').write_bytes(response.read())
