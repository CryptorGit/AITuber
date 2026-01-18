from __future__ import annotations

from typing import List

from PIL import Image, ImageDraw


COLORS = {
    0: (20, 20, 20),
    1: (0, 255, 255),  # I
    2: (255, 255, 0),  # O
    3: (160, 0, 240),  # T
    4: (0, 240, 0),  # S
    5: (240, 0, 0),  # Z
    6: (0, 0, 240),  # J
    7: (240, 160, 0),  # L
}


def render_board(board: List[List[int]], *, cell: int = 24) -> Image.Image:
    height = len(board)
    width = len(board[0]) if height else 0
    img = Image.new("RGB", (width * cell, height * cell), (10, 10, 10))
    draw = ImageDraw.Draw(img)

    for y in range(height):
        for x in range(width):
            v = int(board[y][x])
            color = COLORS.get(v, (200, 200, 200))
            x0 = x * cell
            y0 = y * cell
            draw.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=color, outline=(30, 30, 30))
    return img
