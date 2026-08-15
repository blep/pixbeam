"""pixbeam emitter — displays encoded data frames on screen.

The emitter is the sender side of pixbeam: it encodes a file into a stream
of full-screen images that an HDMI capture card (YUYV 4:2:2) picks up, and
the Rust receiver (crates/pixbeam) decodes them back into the file.

The display core is a pixel-perfect Tk window positioned at exact screen
coordinates, so the frame stream can be placed precisely over the display
that feeds the capture card.

Run:
    uv run python pixbeam/main.py [--file PATH] [--width W] [--height H]
        [--pos-x X] [--pos-y Y] [--fps N]

TODO(pixel-encoding): define the frame layout (sync markers, block number,
payload, integrity CRC) and the color palette that survives YUV 4:2:2
chroma subsampling. The default generator below is a data-seeded test
pattern until then.
"""

from __future__ import annotations

import argparse
import threading
import time
from pathlib import Path

import numpy as np
import tkinter as tk
from PIL import Image, ImageTk


class PixelPerfectDisplay:
    """Tk window showing RGB frames at an exact pixel position and size."""

    def __init__(self, x: int, y: int, width: int, height: int):
        """
        Initialize display at exact pixel position (x, y) with given dimensions.

        Args:
            x: Screen X coordinate for top-left pixel
            y: Screen Y coordinate for top-left pixel
            width: Image width in pixels
            height: Image height in pixels
        """
        self.root = tk.Tk()
        self.root.title("pixbeam emitter")

        # Position window at the requested coordinates. The window manager
        # adds the title bar outside this rectangle, so the client area stays
        # exactly width x height at (x, y).
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        # Closing via the standard title-bar X button / Alt+F4 stops the loop.
        self.root.protocol("WM_DELETE_WINDOW", self.quit)

        # Keep window on top (optional - comment out if not wanted)
        # self.root.wm_attributes("-topmost", True)

        # Configure for pixel-perfect display
        self.root.configure(bg="black")

        # Create canvas for image display
        self.canvas = tk.Canvas(
            self.root,
            width=width,
            height=height,
            highlightthickness=0,  # Remove border
            bg="black",
        )
        self.canvas.pack()

        # Store dimensions
        self.width = width
        self.height = height

        # Image storage
        self.photo = None
        self.image_id = None

        # Control flag for update loop
        self.running = True

        # Bind escape key to exit
        self.root.bind("<Escape>", lambda _e: self.quit())

        # Give the window keyboard focus so Escape works immediately
        self.root.focus_force()

    def update_image(self, image_array: np.ndarray) -> None:
        """
        Update the displayed image from RGB numpy array.

        Args:
            image_array: numpy array of shape (height, width, 3) with dtype uint8
                       Values should be in RGB order (0-255)
        """
        # Validate input
        if image_array.shape != (self.height, self.width, 3):
            raise ValueError(
                f"Expected shape ({self.height}, {self.width}, 3), got {image_array.shape}"
            )

        if image_array.dtype != np.uint8:
            raise ValueError(f"Expected dtype uint8, got {image_array.dtype}")

        # Convert numpy array (RGB) to PIL Image
        # IMPORTANT: PIL Image.fromarray expects RGB by default
        img = Image.fromarray(image_array, "RGB")

        # Convert to PhotoImage for Tkinter
        self.photo = ImageTk.PhotoImage(img)

        # Display on canvas at position (0,0) - top-left corner
        if self.image_id is None:
            self.image_id = self.canvas.create_image(0, 0, anchor=tk.NW, image=self.photo)
        else:
            self.canvas.itemconfig(self.image_id, image=self.photo)

        # Force update
        self.root.update_idletasks()

    def quit(self) -> None:
        """Clean shutdown"""
        self.running = False
        self.root.quit()
        self.root.destroy()

    def run_update_loop(self, update_function, fps: int = 30) -> None:
        """
        Run the display loop with automatic updates.

        Args:
            update_function: Callable that returns a new RGB numpy array
            fps: Frames per second (default 30)
        """

        def update_loop() -> None:
            interval = 1.0 / fps
            while self.running:
                try:
                    # Get new image data from user function
                    image_data = update_function()

                    # Update display
                    self.root.after(0, self.update_image, image_data)

                    # Wait for next frame
                    time.sleep(interval)
                except Exception as e:  # noqa: BLE001 - display loop must not die
                    if not self.running:
                        break  # window was closed; don't print a spurious error
                    print(f"Update error: {e}")
                    break

        # Start update thread
        self.update_thread = threading.Thread(target=update_loop, daemon=True)
        self.update_thread.start()

        # Start Tkinter main loop (blocks until window closes)
        self.root.mainloop()

    def run_blocking(self, update_function, fps: int = 30) -> None:
        """
        Alternative: Run updates in the main thread (simpler but blocks).
        Use this if you don't need to do anything else while running.
        """
        interval = 1.0 / fps
        self.root.update()  # Initial draw

        while self.running:
            start_time = time.time()

            # Get new image data
            image_data = update_function()

            # Update display
            self.update_image(image_data)
            self.root.update()  # Process events

            # Maintain FPS
            elapsed = time.time() - start_time
            if elapsed < interval:
                time.sleep(interval - elapsed)


# ============= EMITTER =============


def make_frame_generator(data: bytes, width: int, height: int):
    """Return a callable producing RGB frames derived from ``data``.

    Each frame is a deterministic, data-seeded pattern so the receiver can
    verify that what the capture card delivers matches what was sent.

    TODO(pixel-encoding): replace with the real encoding — sync markers,
    block number, payload and integrity CRC laid out in colors that survive
    YUV 4:2:2 chroma subsampling.
    """

    frame_number = 0

    def generator() -> np.ndarray:
        nonlocal frame_number
        frame_number += 1
        return encode_pattern_frame(data, width, height, frame_number)

    return generator


def encode_pattern_frame(data: bytes, width: int, height: int, frame_number: int) -> np.ndarray:
    """One data-seeded test frame (RGB uint8, shape (height, width, 3))."""
    # Seed from the payload so the pattern is stable for a given file.
    seed = int.from_bytes(data[:8] or b"\x00" * 8, "little")
    rng = np.random.default_rng(seed + frame_number)

    # Base: horizontal gradient tinted by the payload seed.
    x = np.arange(width, dtype=np.float32)
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[:, :, 0] = (128 + 127 * np.sin(2 * np.pi * x / width + frame_number * 0.1)).astype(np.uint8)
    image[:, :, 1] = (255 * x / width).astype(np.uint8)
    image[:, :, 2] = (128 + 127 * np.sin(4 * np.pi * x / width - frame_number * 0.15)).astype(np.uint8)

    # Noise overlay seeded by the data (drops out on chroma subsampling
    # mostly — the calibration tool exists to measure exactly that).
    noise = rng.integers(0, 30, (height, width, 3), dtype=np.uint8)
    return np.clip(image.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, help="file to encode and transmit")
    parser.add_argument("--width", type=int, default=1920, help="frame width (default 1920)")
    parser.add_argument("--height", type=int, default=1080, help="frame height (default 1080)")
    parser.add_argument("--pos-x", type=int, default=0, help="window X position (default 0)")
    parser.add_argument("--pos-y", type=int, default=0, help="window Y position (default 0)")
    parser.add_argument("--fps", type=int, default=30, help="frames per second (default 30)")
    parser.add_argument(
        "--blocking",
        action="store_true",
        help="run updates on the main thread instead of a background thread",
    )
    args = parser.parse_args()

    data = args.file.read_bytes() if args.file else b"placeholder payload"

    display = PixelPerfectDisplay(args.pos_x, args.pos_y, args.width, args.height)
    generator = make_frame_generator(data, args.width, args.height)

    print(
        f"emitting {len(data)} bytes of data at {args.width}x{args.height} "
        f"({args.fps} fps) — press Escape to quit"
    )
    if args.blocking:
        display.run_blocking(generator, args.fps)
    else:
        display.run_update_loop(generator, args.fps)


if __name__ == "__main__":
    main()
