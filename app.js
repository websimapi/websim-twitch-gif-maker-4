let frames = [];
const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
let gifWorkerBlob;
let selectedAnimation = 'none';
let animationIntensity = 5;
let animationSpeed = 1;
let rainbowEffect = false;
let depthEffect = false;
let useAccuratePreview = true; // Always use accurate preview now
let previewGif = null;

// Image editor variables
let isEditing = false;
let currentTool = 'brush';
let selectionStart = { x: 0, y: 0 };
let selectionEnd = { x: 0, y: 0 };
let isSelecting = false;
let selectedArea = null;
let brushSize = 5;
let brushColor = '#ffffff';
let undoStack = [];
let redoStack = [];

// Special effects selection
document.querySelectorAll('.effect-option').forEach(option => {
    option.addEventListener('click', () => {
        const effect = option.dataset.effect;
        
        if (effect === 'rainbow') {
            rainbowEffect = !rainbowEffect;
            option.classList.toggle('selected');
        }
        
        updateLivePreview();
    });
});

// Animation option selection
document.querySelectorAll('.animation-option').forEach(option => {
    option.addEventListener('click', () => {
        // Remove rainbow-effect since it's now in special effects
        document.querySelectorAll('.animation-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        option.classList.add('selected');
        selectedAnimation = option.dataset.animation;
        updateLivePreview();
    });
});

// Animation settings
document.getElementById('animationSpeed').addEventListener('input', function() {
    animationSpeed = parseFloat(this.value);
    document.getElementById('animationSpeedValue').textContent = `${animationSpeed.toFixed(1)}x`;
    updateLivePreview();
});

document.getElementById('animationIntensity').addEventListener('input', function() {
    animationIntensity = parseInt(this.value);
    document.getElementById('animationIntensityValue').textContent = animationIntensity;
    updateLivePreview();
});

// Fetch GIF Worker
fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js')
    .then(response => response.blob())
    .then(blob => {
        gifWorkerBlob = blob;
    });

document.getElementById('fileInput').addEventListener('change', async (e) => {
    frames = [];
    for (let file of e.target.files) {
        const frame = await createImageBitmap(file);
        frames.push(frame);
    }
    if (frames.length > 0) {
        drawPreview(frames[0]);
        updateLivePreview();
    }
});

document.getElementById('editImage').addEventListener('click', () => {
    if (frames.length === 0) {
        alert('Please upload an image first!');
        return;
    }
    
    startImageEditor(frames[0]);
});

function startImageEditor(image) {
    isEditing = true;
    
    // Show editor panel, hide other content
    document.getElementById('imageEditorPanel').style.display = 'block';
    
    // Set up editor canvas
    const editorCanvas = document.getElementById('editorCanvas');
    const editorCtx = editorCanvas.getContext('2d');
    
    // Set up overlay canvas (for selections, temporary drawing)
    const overlayCanvas = document.getElementById('overlayCanvas');
    const overlayCtx = overlayCanvas.getContext('2d');
    
    // Clear canvases
    editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    // Draw the image centered on canvas
    const scale = Math.min(
        editorCanvas.width / image.width,
        editorCanvas.height / image.height
    ) * 0.9;
    
    const x = (editorCanvas.width - image.width * scale) / 2;
    const y = (editorCanvas.height - image.height * scale) / 2;
    
    editorCtx.drawImage(
        image,
        x, y,
        image.width * scale, image.height * scale
    );
    
    // Save initial state for undo functionality
    saveToUndoStack(editorCanvas);
    
    // Set up tool functionality
    setupEditorTools(editorCanvas, overlayCanvas);
}

function setupEditorTools(editorCanvas, overlayCanvas) {
    const editorCtx = editorCanvas.getContext('2d');
    const overlayCtx = overlayCanvas.getContext('2d');
    
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    
    // Tool selection
    document.querySelectorAll('.tool-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.tool-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            currentTool = option.dataset.tool;
            
            // Hide selection controls if not in selection mode
            if (currentTool !== 'select' && currentTool !== 'magic-wand') {
                document.getElementById('selectionControls').classList.remove('active');
                selectedArea = null;
                // Clear overlay
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }
        });
    });
    
    // Color selection
    document.querySelectorAll('.color-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            brushColor = option.dataset.color;
            document.getElementById('brushColor').value = brushColor;
        });
    });
    
    // Brush color from color picker
    document.getElementById('brushColor').addEventListener('input', function() {
        brushColor = this.value;
        // Update selected color in presets
        document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
    });
    
    // Brush size
    document.getElementById('brushSize').addEventListener('input', function() {
        brushSize = parseInt(this.value);
        document.getElementById('brushSizeValue').textContent = `${brushSize}px`;
    });
    
    // Mouse events for drawing
    overlayCanvas.addEventListener('mousedown', function(e) {
        const rect = overlayCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        switch(currentTool) {
            case 'brush':
            case 'eraser':
                isDrawing = true;
                lastX = x;
                lastY = y;
                break;
                
            case 'select':
                isSelecting = true;
                selectionStart = { x, y };
                break;
                
            case 'magic-wand':
                magicWandSelect(editorCanvas, overlayCanvas, x, y);
                break;
                
            case 'fill':
                fillArea(editorCanvas, x, y, brushColor);
                saveToUndoStack(editorCanvas);
                break;
                
            case 'text':
                addText(editorCanvas, x, y);
                saveToUndoStack(editorCanvas);
                break;
        }
    });
    
    overlayCanvas.addEventListener('mousemove', function(e) {
        const rect = overlayCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (isDrawing) {
            if (currentTool === 'brush') {
                draw(editorCtx, lastX, lastY, x, y);
            } else if (currentTool === 'eraser') {
                erase(editorCtx, lastX, lastY, x, y);
            }
            
            lastX = x;
            lastY = y;
        } else if (isSelecting) {
            // Draw selection rectangle
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            selectionEnd = { x, y };
            
            overlayCtx.strokeStyle = '#9147ff';
            overlayCtx.lineWidth = 2;
            overlayCtx.setLineDash([5, 5]);
            
            const width = selectionEnd.x - selectionStart.x;
            const height = selectionEnd.y - selectionStart.y;
            
            overlayCtx.strokeRect(selectionStart.x, selectionStart.y, width, height);
        }
    });
    
    overlayCanvas.addEventListener('mouseup', function() {
        if (isDrawing) {
            isDrawing = false;
            saveToUndoStack(editorCanvas);
        } else if (isSelecting) {
            isSelecting = false;
            
            // Create selection area
            const left = Math.min(selectionStart.x, selectionEnd.x);
            const top = Math.min(selectionStart.y, selectionEnd.y);
            const width = Math.abs(selectionEnd.x - selectionStart.x);
            const height = Math.abs(selectionEnd.y - selectionStart.y);
            
            // Only create selection if it has size
            if (width > 5 && height > 5) {
                selectedArea = { left, top, width, height };
                document.getElementById('selectionControls').classList.add('active');
            } else {
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }
        }
    });
    
    // Selection controls
    document.getElementById('cropSelection').addEventListener('click', function() {
        if (selectedArea) {
            cropSelection(editorCanvas, selectedArea);
            clearSelection(overlayCanvas);
            saveToUndoStack(editorCanvas);
        }
    });
    
    document.getElementById('fillSelection').addEventListener('click', function() {
        if (selectedArea) {
            fillSelection(editorCanvas, selectedArea, brushColor);
            clearSelection(overlayCanvas);
            saveToUndoStack(editorCanvas);
        }
    });
    
    document.getElementById('deleteSelection').addEventListener('click', function() {
        if (selectedArea) {
            deleteSelection(editorCanvas, selectedArea);
            clearSelection(overlayCanvas);
            saveToUndoStack(editorCanvas);
        }
    });
    
    document.getElementById('makeTransparent').addEventListener('click', function() {
        if (selectedArea) {
            makeSelectionTransparent(editorCanvas, selectedArea);
            clearSelection(overlayCanvas);
            saveToUndoStack(editorCanvas);
        }
    });
    
    document.getElementById('cancelSelection').addEventListener('click', function() {
        clearSelection(overlayCanvas);
    });
    
    // Editor control buttons
    document.getElementById('undoEdit').addEventListener('click', function() {
        if (undoStack.length > 1) {
            redoStack.push(undoStack.pop());
            const prevState = undoStack[undoStack.length - 1];
            restoreCanvasState(editorCanvas, prevState);
        }
    });
    
    document.getElementById('redoEdit').addEventListener('click', function() {
        if (redoStack.length > 0) {
            const nextState = redoStack.pop();
            restoreCanvasState(editorCanvas, nextState);
            undoStack.push(nextState);
        }
    });
    
    document.getElementById('saveEdit').addEventListener('click', function() {
        finishEditing(editorCanvas);
    });
    
    document.getElementById('cancelEdit').addEventListener('click', function() {
        isEditing = false;
        document.getElementById('imageEditorPanel').style.display = 'none';
        undoStack = [];
        redoStack = [];
    });
}

function draw(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function erase(ctx, x1, y1, x2, y2) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
}

function clearSelection(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    selectedArea = null;
    document.getElementById('selectionControls').classList.remove('active');
}

function cropSelection(canvas, area) {
    const ctx = canvas.getContext('2d');
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = area.width;
    tempCanvas.height = area.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Copy selection to temp canvas
    tempCtx.drawImage(
        canvas, 
        area.left, area.top, area.width, area.height,
        0, 0, area.width, area.height
    );
    
    // Clear original canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw cropped image centered
    const x = (canvas.width - area.width) / 2;
    const y = (canvas.height - area.height) / 2;
    ctx.drawImage(tempCanvas, x, y);
}

function fillSelection(canvas, area, color) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(area.left, area.top, area.width, area.height);
}

function deleteSelection(canvas, area) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(area.left, area.top, area.width, area.height);
}

function makeSelectionTransparent(canvas, area) {
    const ctx = canvas.getContext('2d');
    
    // Get image data from selection
    const imageData = ctx.getImageData(area.left, area.top, area.width, area.height);
    const data = imageData.data;
    
    // Make all pixels transparent (set alpha to 0)
    for (let i = 0; i < data.length; i += 4) {
        data[i + 3] = 0; // Alpha channel
    }
    
    // Put the modified image data back
    ctx.putImageData(imageData, area.left, area.top);
}

function magicWandSelect(sourceCanvas, overlayCanvas, x, y) {
    const sourceCtx = sourceCanvas.getContext('2d');
    const overlayCtx = overlayCanvas.getContext('2d');
    
    // Get image data
    const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const data = imageData.data;
    
    // Get the color at the selected point
    const targetIndex = (y * sourceCanvas.width + x) * 4;
    const targetColor = {
        r: data[targetIndex],
        g: data[targetIndex + 1],
        b: data[targetIndex + 2],
        a: data[targetIndex + 3]
    };
    
    // Tolerance for color matching
    const tolerance = 30;
    
    // Create a selection mask
    const mask = new Uint8Array(sourceCanvas.width * sourceCanvas.height);
    
    // Flood fill algorithm
    const stack = [{x, y}];
    
    while (stack.length > 0) {
        const {x, y} = stack.pop();
        
        if (x < 0 || y < 0 || x >= sourceCanvas.width || y >= sourceCanvas.height)
            continue;
        
        const index = y * sourceCanvas.width + x;
        
        if (mask[index] === 1)
            continue;
        
        const pixelIndex = index * 4;
        const pixelColor = {
            r: data[pixelIndex],
            g: data[pixelIndex + 1],
            b: data[pixelIndex + 2],
            a: data[pixelIndex + 3]
        };
        
        // Check if colors are similar
        if (
            Math.abs(pixelColor.r - targetColor.r) <= tolerance &&
            Math.abs(pixelColor.g - targetColor.g) <= tolerance &&
            Math.abs(pixelColor.b - targetColor.b) <= tolerance &&
            Math.abs(pixelColor.a - targetColor.a) <= tolerance
        ) {
            mask[index] = 1;
            
            stack.push({x: x + 1, y});
            stack.push({x: x - 1, y});
            stack.push({x, y: y + 1});
            stack.push({x, y: y - 1});
        }
    }
    
    // Clear overlay and draw selection
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    // Create a selection path
    const selection = createSelectionPath(mask, sourceCanvas.width, sourceCanvas.height);
    
    // Draw selection outline
    overlayCtx.strokeStyle = '#9147ff';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([5, 5]);
    
    if (selection) {
        overlayCtx.stroke(selection.path);
        selectedArea = selection.bounds;
        document.getElementById('selectionControls').classList.add('active');
    }
}

function createSelectionPath(mask, width, height) {
    // Find bounds of selection
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasSelection = false;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            if (mask[index] === 1) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                hasSelection = true;
            }
        }
    }
    
    if (!hasSelection) return null;
    
    // Create a simplified path around the selection
    const path = new Path2D();
    const bounds = {
        left: minX,
        top: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
    
    path.rect(minX, minY, bounds.width, bounds.height);
    
    return { path, bounds };
}

function fillArea(canvas, x, y, fillColor) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Get the color at the selected point
    const targetIndex = (y * canvas.width + x) * 4;
    const targetColor = {
        r: data[targetIndex],
        g: data[targetIndex + 1],
        b: data[targetIndex + 2],
        a: data[targetIndex + 3]
    };
    
    // Tolerance for color matching
    const tolerance = 30;
    
    // Convert fill color hex to rgba
    const r = parseInt(fillColor.slice(1, 3), 16);
    const g = parseInt(fillColor.slice(3, 5), 16);
    const b = parseInt(fillColor.slice(5, 7), 16);
    
    // Flood fill algorithm
    const stack = [{x, y}];
    const visited = new Uint8Array(canvas.width * canvas.height);
    
    while (stack.length > 0) {
        const {x, y} = stack.pop();
        
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height)
            continue;
        
        const index = y * canvas.width + x;
        
        if (visited[index] === 1)
            continue;
        
        const pixelIndex = index * 4;
        const pixelColor = {
            r: data[pixelIndex],
            g: data[pixelIndex + 1],
            b: data[pixelIndex + 2],
            a: data[pixelIndex + 3]
        };
        
        // Check if colors are similar
        if (
            Math.abs(pixelColor.r - targetColor.r) <= tolerance &&
            Math.abs(pixelColor.g - targetColor.g) <= tolerance &&
            Math.abs(pixelColor.b - targetColor.b) <= tolerance &&
            Math.abs(pixelColor.a - targetColor.a) <= tolerance
        ) {
            visited[index] = 1;
            
            // Set new color
            data[pixelIndex] = r;
            data[pixelIndex + 1] = g;
            data[pixelIndex + 2] = b;
            
            stack.push({x: x + 1, y});
            stack.push({x: x - 1, y});
            stack.push({x, y: y + 1});
            stack.push({x, y: y - 1});
        }
    }
    
    // Put the modified image data back
    ctx.putImageData(imageData, 0, 0);
}

function addText(canvas, x, y) {
    const ctx = canvas.getContext('2d');
    const text = prompt('Enter text:', '');
    
    if (!text) return;
    
    ctx.font = `${brushSize * 2}px sans-serif`;
    ctx.fillStyle = brushColor;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
}

function saveToUndoStack(canvas) {
    // Save current state to undo stack
    const imageData = canvas.toDataURL();
    undoStack.push(imageData);
    // Clear redo stack after a new action
    redoStack = [];
}

function restoreCanvasState(canvas, imageData) {
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
    img.src = imageData;
}

async function finishEditing(canvas) {
    // Convert canvas to image bitmap
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    const newFrame = await createImageBitmap(blob);
    
    // Replace the current frame
    frames[0] = newFrame;
    
    // Update preview
    drawPreview(newFrame);
    updateLivePreview();
    
    // Hide editor panel
    isEditing = false;
    document.getElementById('imageEditorPanel').style.display = 'none';
    undoStack = [];
    redoStack = [];
}

function drawPreview(frame) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
}

// Update value displays
document.getElementById('fps').addEventListener('input', function() {
    document.getElementById('fpsValue').textContent = `${this.value} FPS`;
});

document.getElementById('quality').addEventListener('input', function() {
    document.getElementById('qualityValue').textContent = this.value;
});

document.getElementById('duration').addEventListener('input', function() {
    document.getElementById('durationValue').textContent = `${this.value}s`;
});

function getImageSettings() {
    return {
        backgroundColor: document.getElementById('enableBackground').checked ? document.getElementById('backgroundColor').value : null,
        opacity: parseInt(document.getElementById('opacity').value),
        scale: parseInt(document.getElementById('scale').value)
    };
}

document.getElementById('enableBackground').addEventListener('change', function() {
    document.getElementById('backgroundColor').disabled = !this.checked;
    updateLivePreview();
});

document.getElementById('backgroundColor').addEventListener('input', function() {
    document.getElementById('backgroundColorValue').textContent = this.value;
    updateLivePreview();
});

document.querySelectorAll('.image-settings input, .image-settings select').forEach(input => {
    input.addEventListener('input', updateLivePreview);
});

function generateAnimationCSS(animationType) {
    const duration = (1 / animationSpeed).toFixed(1);
    const intensity = animationIntensity / 5;
    
    switch(animationType) {
        case 'rotate':
            return `rotate ${duration}s linear infinite`;
        case 'bounce':
            return `bounce ${duration}s ease-in-out infinite`;
        case 'fade':
            return `fade ${duration}s ease-in-out infinite`;
        case 'shake':
            return `shake ${duration}s ease-in-out infinite`;
        case 'pulse':
            return `pulse ${duration}s ease-in-out infinite`;
        case 'flip':
            return `flip ${duration}s ease-in-out infinite`;
        case 'swing':
            return `swing ${duration}s ease-in-out infinite`;
        case 'zoom':
            return `zoom ${duration}s ease-in-out infinite`;
        case 'spin':
            return `spin ${duration}s linear infinite`;
        case 'wiggle':
            return `wiggle ${duration}s ease-in-out infinite`;
        case 'squeeze':
            return `squeeze ${duration}s ease-in-out infinite`;
        case 'slide':
            return `slide ${duration}s ease-in-out infinite`;
        case 'glitch':
            return `glitch ${duration}s ease-in-out infinite`;
        case 'bounce-around':
            return `bounceAround ${duration}s ease-in-out infinite`;
        case 'float':
            return `float ${duration}s ease-in-out infinite`;
        case 'spiral':
            return `spiral ${duration}s linear infinite`;
        case 'throb':
            return `throb ${duration}s ease-in-out infinite`;
        case 'heartbeat':
            return `heartbeat ${duration}s ease-in-out infinite`;
        case 'jello':
            return `jello ${duration}s ease-in-out infinite`;
        case 'pendulum':
            return `pendulum ${duration}s ease-in-out infinite`;
        case 'blink':
            return `blink ${duration}s step-end infinite`;
        case 'rainbow':
            return `rainbow ${duration}s linear infinite`;
        case 'tornado':
            return `tornado ${duration}s ease-in-out infinite`;
        case 'orbit':
            return `orbit ${duration}s linear infinite`;
        case 'diagonal-bounce':
            return `diagonalBounce ${duration}s ease-in-out infinite`;
        case 'pixelate':
            return `pixelate ${duration}s ease-in-out infinite`;
        case 'sway':
            return `sway ${duration}s ease-in-out infinite`;
        case 'ripple':
            return `ripple ${duration}s ease-in-out infinite`;
        case 'split-shift':
            return `splitShift ${duration}s ease-in-out infinite`;
        case 'confetti':
            return `confetti ${duration}s linear infinite`;
        case 'wave':
            return `wave ${duration}s ease-in-out infinite`;
        case 'jump-rope':
            return `jumpRope ${duration}s ease-in-out infinite`;
        case 'typewriter':
            return `typewriter ${duration}s steps(8, end) infinite`;
        case 'bounce-flip':
            return `bounceFlip ${duration}s ease-in-out infinite`;
        case 'dizzy':
            return `dizzy ${duration}s ease-in-out infinite`;
        case 'dance':
            return `dance ${duration}s ease-in-out infinite`;
        case 'elastic':
            return `elastic ${duration}s cubic-bezier(.68,-0.55,.27,1.55) infinite`;
        case 'shadow-play':
            return `shadowPlay ${duration}s ease-in-out infinite`;
        case 'bounce-rotate':
            return `bounceRotate ${duration}s ease-in-out infinite`;
        case 'party-mode':
            return `partyMode ${duration}s ease-in-out infinite`;
        case 'rolling':
            return `rolling ${duration}s ease-in-out infinite`;
        case 'kaleidoscope':
            return `kaleidoscope ${duration}s linear infinite`;
        case 'wobble':
            return `wobble ${duration}s ease-in-out infinite`;
        case 'teleport':
            return `teleport ${duration}s ease-in-out infinite`;
        case 'pinwheel':
            return `pinwheel ${duration}s linear infinite`;
        case 'rainbow-effect':
            return `rainbow ${duration}s linear infinite`;
        case 'bounce-orbit':
            return `bounceOrbit ${duration}s ease-in-out infinite`;
        case 'vvcool':
            return `vvcool ${duration}s linear infinite`;
        case 'neon-flash':
            return `neonFlash ${duration}s linear infinite`;
        case 'spin-zoom':
            return `spinZoom ${duration}s ease-in-out infinite`;
        case 'bounce-wave':
            return `bounceWave ${duration}s ease-in-out infinite`;
        case 'hyperspeed':
            return `hyperspeed ${duration}s linear infinite`;
        case 'color-pulse':
            return `colorPulse ${duration}s linear infinite`;
        case 'pixel-shuffle':
            return `pixelShuffle ${duration}s linear infinite`;
        case 'glitch-out':
            return `glitchOut ${duration}s ease-in-out infinite`;
        case 'liquid':
            return `liquid ${duration}s ease-in-out infinite`;
        case 'warp-drive':
            return `warpDrive ${duration}s linear infinite`;
        case 'micro-bounce':
            return `microBounce ${duration}s ease-in-out infinite`;
        case 'shatter':
            return `shatter ${duration}s ease-in-out infinite`;
        case 'clock':
            return `clock ${duration}s linear infinite`;
        case 'slime':
            return `slime ${duration}s ease-in-out infinite`;
        case 'paper-plane':
            return `paperPlane ${duration}s ease-in-out infinite`;
        case 'bubble-pop':
            return `bubblePop ${duration}s ease-in-out infinite`;
        case 'vibrate':
            return `vibrate ${duration}s linear infinite`;
        case 'firework':
            return `firework ${duration}s ease-out infinite`;
        case 'magnet':
            return `magnet ${duration}s ease-in-out infinite`;
        case 'pulse-rings':
            return `pulseRings ${duration}s ease-in-out infinite`;
        case 'drip':
            return `drip ${duration}s ease-in-out infinite`;
        case 'ricochet':
            return `ricochet ${duration}s ease-in-out infinite`;
        case 'flip-3d':
            return `flip3D ${duration}s ease-in-out infinite`;
        case 'thunder':
            return `thunder ${duration}s ease-in-out infinite`;
        case 'tv-static':
            return `tvStatic ${duration}s step-end infinite`;
        case 'flip-coin':
            return `flipCoin ${duration}s linear infinite`;
        case 'matrix':
            return `matrix ${duration}s ease-in-out infinite`;
        case 'meteor':
            return `meteor ${duration}s linear infinite`;
        case 'pendulum-wave':
            return `pendulumWave ${duration}s ease-in-out infinite`;
        case 'tumbleweed':
            return `tumbleweed ${duration}s linear infinite`;
        case 'gentle-shake':
            return `gentleShake ${duration}s ease-in-out infinite`;
        case 'tiny-jump':
            return `tinyJump ${duration}s ease-in-out infinite`;
        case 'subtle-pulse':
            return `subtlePulse ${duration}s ease-in-out infinite`;
        case 'soft-wobble':
            return `softWobble ${duration}s ease-in-out infinite`;
        case 'micro-spin':
            return `microSpin ${duration}s linear infinite`;
        case 'mini-orbit':
            return `miniOrbit ${duration}s linear infinite`;
        case 'light-flicker':
            return `lightFlicker ${duration}s step-end infinite`;
        case 'smooth-slide':
            return `smoothSlide ${duration}s ease-in-out infinite`;
        case 'tiny-twist':
            return `tinyTwist ${duration}s ease-in-out infinite`;
        case 'quick-pulse':
            return `quickPulse ${duration}s ease-in-out infinite`;
        case 'mini-rotate':
            return `miniRotate ${duration}s linear infinite`;
        case 'soft-breathe':
            return `softBreathe ${duration}s ease-in-out infinite`;
        case 'nano-bounce':
            return `nanoBounce ${duration}s ease-in-out infinite`;
        case 'subtle-wave':
            return `subtleWave ${duration}s ease-in-out infinite`;
        case 'gentle-rock':
            return `gentleRock ${duration}s ease-in-out infinite`;
        case 'tiny-bounce':
            return `tinyBounce ${duration}s ease-in-out infinite`;
        case 'micro-waggle':
            return `microWaggle ${duration}s ease-in-out infinite`;
        case 'soft-vibrate':
            return `softVibrate ${duration}s linear infinite`;
        case 'micro-float':
            return `microFloat ${duration}s ease-in-out infinite`;
        case 'subtle-throb':
            return `subtleThrob ${duration}s ease-in-out infinite`;
        case 'diagonal-shake':
            return `diagonal-shake ${duration}s ease-in-out infinite`;
        case 'diagonal-jitter':
            return `diagonal-jitter ${duration}s ease-in-out infinite`;
        case 'diagonal-pulse-shake':
            return `diagonal-pulse-shake ${duration}s ease-in-out infinite`;
        case 'diagonal-zigzag':
            return `diagonal-zigzag ${duration}s ease-in-out infinite`;
        case 'diagonal-wave-shake':
            return `diagonal-wave-shake ${duration}s ease-in-out infinite`;
        default:
            return '';
    }
}

function updateLivePreview() {
    const previewCanvas = document.getElementById('previewAnimation');
    const ctx = previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (frames.length === 0) return;

    const settings = getImageSettings();
    
    generateAccuratePreview(previewCanvas, settings);
}

async function generateAccuratePreview(previewCanvas, settings) {
    if (!gifWorkerBlob) {
        // Wait for GIF worker to be fetched
        await new Promise(resolve => {
            const checkWorker = () => {
                if (gifWorkerBlob) {
                    resolve();
                } else {
                    setTimeout(checkWorker, 100);
                }
            };
            checkWorker();
        });
    }
    
    // Show loading indicator
    const livePreview = document.getElementById('livePreview');
    const loadingEl = document.createElement('div');
    loadingEl.className = 'preview-loading';
    loadingEl.innerHTML = '<div class="loading-spinner"></div>';
    livePreview.appendChild(loadingEl);
    
    // Clean up any previous preview
    if (previewGif) {
        URL.revokeObjectURL(previewGif);
        previewGif = null;
    }
    
    // Set up temporary canvas for rendering frames
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 112;
    tempCanvas.height = 112;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Create a GIF instance for preview
    const gif = new GIF({
        workers: 1,
        quality: 5, // Lower quality for preview
        width: 112,
        height: 112,
        workerScript: URL.createObjectURL(gifWorkerBlob),
        transparent: settings.backgroundColor ? null : 0x00000000
    });
    
    // Generate a few frames for preview
    const fps = 10; // Lower fps for preview
    const previewDuration = 1; // 1 second preview
    const totalFrames = fps * previewDuration;
    
    for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
        const progress = frameNum / totalFrames;
        
        frames.forEach((frame) => {
            tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            if (settings.backgroundColor) {
                tempCtx.fillStyle = settings.backgroundColor;
                tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            }
            
            const scale = settings.scale / 100;
            const scaledWidth = tempCanvas.width * scale;
            const scaledHeight = tempCanvas.height * scale;
            const x = (tempCanvas.width - scaledWidth) / 2;
            const y = (tempCanvas.height - scaledHeight) / 2;
            
            const effectiveWidth = scaledWidth;
            const effectiveHeight = scaledHeight;
            
            tempCtx.save();
            
            // Apply animation transforms to the context
            if (selectedAnimation !== 'none') {
                const centerX = x + (effectiveWidth / 2);
                const centerY = y + (effectiveHeight / 2);
                
                tempCtx.translate(centerX, centerY);
                
                const intensityFactor = animationIntensity / 5;
                
                switch(selectedAnimation) {
                    case 'rotate':
                        tempCtx.rotate(progress * Math.PI * 2);
                        break;
                    case 'bounce':
                        const bounceOffset = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        tempCtx.translate(0, bounceOffset);
                        break;
                    case 'fade':
                        tempCtx.globalAlpha = (settings.opacity / 100) * (0.3 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.7);
                        break;
                    case 'shake':
                        const shakeOffset = Math.sin(progress * Math.PI * 4) * 5 * intensityFactor;
                        tempCtx.translate(shakeOffset, 0);
                        break;
                    case 'pulse':
                        const pulseScale = 1 + Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        tempCtx.scale(pulseScale, pulseScale);
                        break;
                    case 'flip':
                        const flipProgress = Math.sin(progress * Math.PI * 2);
                        tempCtx.scale(flipProgress < 0 ? -1 : 1, 1);
                        break;
                    case 'swing':
                        const swingAngle = Math.sin(progress * Math.PI * 2) * 15 * intensityFactor * (Math.PI / 180);
                        tempCtx.rotate(swingAngle);
                        break;
                    case 'zoom':
                        const zoomScale = 1 - Math.abs(Math.sin(progress * Math.PI * 2)) * 0.3 * intensityFactor;
                        tempCtx.scale(zoomScale, zoomScale);
                        break;
                    case 'spin':
                        const spinRotation = progress * Math.PI * 2;
                        const spinScale = 1 - Math.abs(Math.sin(progress * Math.PI)) * 0.2 * intensityFactor;
                        tempCtx.rotate(spinRotation);
                        tempCtx.scale(spinScale, spinScale);
                        break;
                    case 'wiggle':
                        const wiggleAngle = Math.sin(progress * Math.PI * 4) * 10 * intensityFactor * (Math.PI / 180);
                        tempCtx.transform(1, 0, Math.tan(wiggleAngle), 1, 0, 0);
                        break;
                    case 'squeeze':
                        const squeezeX = 1 + Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        const squeezeY = 1 - Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        tempCtx.scale(squeezeX, squeezeY);
                        break;
                    case 'slide':
                        const slideOffset = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        tempCtx.translate(slideOffset, 0);
                        break;
                    case 'glitch':
                        if (progress * 10 % 1 < 0.3) {
                            const glitchX = (Math.random() - 0.5) * 8 * intensityFactor;
                            const glitchY = (Math.random() - 0.5) * 8 * intensityFactor;
                            tempCtx.translate(glitchX, glitchY);
                        }
                        break;
                    case 'bounce-around':
                        // Bounce around corners in a loop
                        const cycle = (progress * 4) % 4;
                        let xOffset = 0, yOffset = 0;
                        
                        if (cycle < 1) { // Top-left to top-right
                            xOffset = cycle * 10 * intensityFactor;
                            yOffset = -5 * intensityFactor;
                        } else if (cycle < 2) { // Top-right to bottom-right
                            xOffset = 10 * intensityFactor;
                            yOffset = (cycle - 1) * 10 * intensityFactor - 5 * intensityFactor;
                        } else if (cycle < 3) { // Bottom-right to bottom
                            xOffset = (3 - cycle) * 10 * intensityFactor;
                            yOffset = 5 * intensityFactor;
                        } else { // Bottom to top-left
                            xOffset = -10 * intensityFactor;
                            yOffset = (4 - cycle) * 10 * intensityFactor - 5 * intensityFactor;
                        }
                        
                        tempCtx.translate(xOffset, yOffset);
                        tempCtx.rotate(-cycle * Math.PI / 2);
                        break;
                    case 'float':
                        const floatY = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        const floatRotation = Math.sin(progress * Math.PI * 2) * 2 * intensityFactor * (Math.PI / 180);
                        tempCtx.translate(0, floatY);
                        tempCtx.rotate(floatRotation);
                        break;
                    case 'spiral':
                        const spiralRotation = progress * Math.PI * 2;
                        const spiralScale = 0.5 + Math.abs(Math.sin(progress * Math.PI)) * 0.5 * intensityFactor;
                        tempCtx.rotate(spiralRotation);
                        tempCtx.scale(spiralScale, spiralScale);
                        break;
                    case 'throb':
                        const throbScale = 1 + Math.sin(progress * Math.PI * 2) * 0.3 * intensityFactor;
                        tempCtx.scale(throbScale, throbScale);
                        tempCtx.globalAlpha = (settings.opacity / 100) * (0.8 + Math.sin(progress * Math.PI * 2) * 0.2);
                        break;
                    case 'heartbeat':
                        const t = progress * 10 % 1;
                        let heartbeatScale = 1;
                        if (t < 0.1) heartbeatScale = 1.2 * intensityFactor;
                        else if (t < 0.2) heartbeatScale = 1.1 * intensityFactor;
                        else if (t < 0.3) heartbeatScale = 1.0;
                        else if (t < 0.4) heartbeatScale = 1.25 * intensityFactor;
                        else if (t < 0.5) heartbeatScale = 1.15 * intensityFactor;
                        tempCtx.scale(heartbeatScale, heartbeatScale);
                        break;
                    case 'jello':
                        const jelloProgress = progress * 4 % 1;
                        const skewX = Math.sin(jelloProgress * Math.PI * 2) * 15 * intensityFactor * (Math.PI / 180);
                        const skewY = Math.sin(jelloProgress * Math.PI * 2) * 5 * intensityFactor * (Math.PI / 180);
                        tempCtx.transform(1, Math.tan(skewY), Math.tan(skewX), 1, 0, 0);
                        break;
                    case 'pendulum':
                        const pendulumAngle = Math.sin(progress * Math.PI * 2) * 20 * intensityFactor * (Math.PI / 180);
                        tempCtx.rotate(pendulumAngle);
                        break;
                    case 'blink':
                        if ((progress * 2) % 1 < 0.5) {
                            tempCtx.globalAlpha = 0;
                        }
                        break;
                    case 'rainbow':
                        // Apply rainbow effect directly to each frame
                        tempCtx.filter = `hue-rotate(${progress * 360}deg)`;
                        break;
                    case 'tornado':
                        const tornadoAngle = progress * Math.PI * 2;
                        const tornadoScale = 0.6 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.4;
                        const tornadoX = Math.sin(progress * Math.PI * 4) * 10 * intensityFactor;
                        tempCtx.rotate(tornadoAngle);
                        tempCtx.scale(tornadoScale, tornadoScale);
                        tempCtx.translate(tornadoX, 0);
                        break;
                    case 'orbit':
                        const orbitAngle = progress * Math.PI * 2;
                        const orbitRadius = 15 * intensityFactor;
                        tempCtx.translate(
                            Math.cos(orbitAngle) * orbitRadius,
                            Math.sin(orbitAngle) * orbitRadius
                        );
                        tempCtx.rotate(-orbitAngle);
                        break;
                    case 'diagonal-bounce':
                        const diagProgress = progress * 4 % 4;
                        let diagX = 0, diagY = 0, diagRotation = 0;
                        
                        if (diagProgress < 1) {
                            diagX = diagY = 0;
                        } else if (diagProgress < 2) {
                            diagX = 15 * intensityFactor;
                            diagY = -15 * intensityFactor;
                            diagRotation = -5 * (diagProgress - 1);
                        } else if (diagProgress < 3) {
                            diagX = -15 * intensityFactor;
                            diagY = 15 * intensityFactor;
                            diagRotation = 5 * (diagProgress - 2);
                        } else {
                            diagX = 15 * intensityFactor;
                            diagY = 15 * intensityFactor;
                            diagRotation = -5 * (diagProgress - 3);
                        }
                        
                        tempCtx.translate(diagX, diagY);
                        tempCtx.rotate(diagRotation * (Math.PI / 180));
                        break;
                    case 'pixelate':
                        const pixelProgress = Math.sin(progress * Math.PI * 2);
                        const pixelScale = 1 - Math.abs(pixelProgress) * 0.4 * intensityFactor;
                        tempCtx.scale(pixelScale, pixelScale);
                        // Note: image-rendering and filter can't be applied to canvas context directly
                        break;
                    case 'sway':
                        const swayProgress = Math.sin(progress * Math.PI * 2);
                        const swayAngle = swayProgress * 10 * intensityFactor * (Math.PI / 180);
                        const swayX = swayProgress * 10 * intensityFactor;
                        tempCtx.transform(1, 0, Math.tan(swayAngle), 1, swayX, 0);
                        break;
                    case 'ripple':
                        const rippleProgress = Math.sin(progress * Math.PI * 2);
                        const rippleScale = 1 + rippleProgress * 0.2 * intensityFactor;
                        // Blur can't be applied directly to canvas context
                        tempCtx.scale(rippleScale, rippleScale);
                        break;
                    case 'split-shift':
                        // Split-shift effect can't be fully recreated in canvas context
                        // We can approximate with small position shifts
                        const splitShiftProgress = progress * 10 % 1;
                        if (splitShiftProgress < 0.25) {
                            tempCtx.translate(-5 * intensityFactor, 0);
                        } else if (splitShiftProgress < 0.5) {
                            tempCtx.translate(0, -5 * intensityFactor);
                        } else if (splitShiftProgress < 0.75) {
                            tempCtx.translate(5 * intensityFactor, 0);
                        } else {
                            tempCtx.translate(0, 5 * intensityFactor);
                        }
                        break;
                    case 'confetti':
                        const confettiAngle = progress * Math.PI * 2;
                        const confettiScale = 0.8 + Math.sin(progress * Math.PI * 4) * 0.2 * intensityFactor;
                        tempCtx.rotate(confettiAngle);
                        tempCtx.scale(confettiScale, confettiScale);
                        // Color changes handled in CSS
                        break;
                    case 'wave':
                        const waveY = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        const waveSkew = Math.sin(progress * Math.PI * 2) * 15 * intensityFactor * (Math.PI / 180);
                        tempCtx.transform(1, 0, Math.tan(waveSkew), 1, 0, waveY);
                        break;
                    case 'jump-rope':
                        const jumpY = Math.abs(Math.sin(progress * Math.PI * 2)) * -15 * intensityFactor;
                        const jumpScale = 1 - Math.abs(Math.sin(progress * Math.PI * 2)) * 0.3 * intensityFactor;
                        const jumpRotation = Math.sin(progress * Math.PI * 2) * 15 * intensityFactor * (Math.PI / 180);
                        tempCtx.translate(0, jumpY);
                        tempCtx.scale(1, jumpScale);
                        tempCtx.rotate(jumpRotation);
                        break;
                    case 'typewriter':
                        // Typewriter effect - implemented through clipping
                        const typeProgress = progress * 4 % 1;
                        const clipWidth = tempCanvas.width * (1 - typeProgress);
                        tempCtx.beginPath();
                        tempCtx.rect(0, 0, clipWidth, tempCanvas.height);
                        tempCtx.clip();
                        break;
                    case 'bounce-flip':
                        const bfProgress = progress * 4 % 4;
                        let bfY = 0, bfRotationY = 0;
                        
                        if (bfProgress < 1) {
                            bfY = -10 * intensityFactor * Math.sin(bfProgress * Math.PI);
                            bfRotationY = bfProgress * 90;
                        } else if (bfProgress < 2) {
                            bfRotationY = 90 + (bfProgress - 1) * 90;
                        } else if (bfProgress < 3) {
                            bfY = -10 * intensityFactor * Math.sin((bfProgress - 2) * Math.PI);
                            bfRotationY = 180 + (bfProgress - 2) * 90;
                        } else {
                            bfRotationY = 270 + (bfProgress - 3) * 90;
                        }
                        
                        tempCtx.translate(0, bfY);
                        // Simulate 3D rotation by scaling
                        const scaleX = Math.abs(Math.cos(bfRotationY * Math.PI / 180));
                        tempCtx.scale(scaleX, 1);
                        break;
                    case 'dizzy':
                        const dizzyAngle = progress * Math.PI * 2;
                        const dizzyScale = 0.8 + Math.sin(progress * Math.PI * 3) * 0.2 * intensityFactor;
                        const dizzyX = Math.sin(progress * Math.PI * 3) * 10 * intensityFactor;
                        tempCtx.rotate(dizzyAngle);
                        tempCtx.scale(dizzyScale, dizzyScale);
                        tempCtx.translate(dizzyX, 0);
                        break;
                    case 'dance':
                        const danceRotation = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor * (Math.PI / 180);
                        const danceY = Math.sin(progress * Math.PI * 2) * -10 * intensityFactor;
                        const danceSkewX = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor * (Math.PI / 180);
                        tempCtx.rotate(danceRotation);
                        tempCtx.transform(1, 0, Math.tan(danceSkewX), 1, 0, danceY);
                        break;
                    case 'elastic':
                        const elasticProgress = progress * 4 % 1;
                        let elasticScaleX = 1, elasticScaleY = 1;
                        
                        if (elasticProgress < 0.25) {
                            elasticScaleX = 1 + elasticProgress * 2 * intensityFactor;
                            elasticScaleY = 1 - elasticProgress * 2 * intensityFactor;
                        } else if (elasticProgress < 0.5) {
                            const t = (elasticProgress - 0.25) * 4;
                            elasticScaleX = 1.5 * intensityFactor - t * intensityFactor;
                            elasticScaleY = 0.5 + t * intensityFactor;
                        } else if (elasticProgress < 0.75) {
                            const t = (elasticProgress - 0.5) * 4;
                            elasticScaleX = 1 - t * intensityFactor;
                            elasticScaleY = 1 + t * intensityFactor;
                        } else {
                            const t = (elasticProgress - 0.75) * 4;
                            elasticScaleX = 0.8 + t * 0.2 * intensityFactor;
                            elasticScaleY = 1.2 - t * 0.2 * intensityFactor;
                        }
                        
                        tempCtx.scale(elasticScaleX, elasticScaleY);
                        break;
                    case 'shadow-play':
                        const shadowX = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        const shadowRotation = Math.sin(progress * Math.PI * 2) * 5 * intensityFactor * (Math.PI / 180);
                        tempCtx.translate(shadowX, 0);
                        tempCtx.rotate(shadowRotation);
                        // Shadow effect can't be applied directly in canvas context
                        break;
                    case 'bounce-rotate':
                        const brY = Math.sin(progress * Math.PI * 2) * -15 * intensityFactor;
                        const brRotation = progress * Math.PI * 2;
                        tempCtx.translate(0, brY);
                        tempCtx.rotate(brRotation);
                        break;
                    case 'party-mode':
                        const partyPhase = (progress * 5) % 5;
                        if (partyPhase < 1) {
                            tempCtx.scale(1 + 0.1 * intensityFactor, 1 + 0.1 * intensityFactor);
                            tempCtx.rotate(10 * intensityFactor * (Math.PI / 180));
                        } else if (partyPhase < 2) {
                            tempCtx.scale(0.9 * intensityFactor, 0.9 * intensityFactor);
                            tempCtx.translate(5 * intensityFactor, -5 * intensityFactor);
                            tempCtx.rotate(-5 * intensityFactor * (Math.PI / 180));
                        } else if (partyPhase < 3) {
                            tempCtx.scale(1.2 * intensityFactor, 1.2 * intensityFactor);
                            tempCtx.translate(-5 * intensityFactor, 5 * intensityFactor);
                            tempCtx.rotate(15 * intensityFactor * (Math.PI / 180));
                        } else if (partyPhase < 4) {
                            tempCtx.scale(0.8 * intensityFactor, 0.8 * intensityFactor);
                            tempCtx.rotate(-15 * intensityFactor * (Math.PI / 180));
                        } else {
                            tempCtx.scale(1, 1);
                            tempCtx.rotate(0);
                        }
                        break;
                    case 'rolling':
                        const rollX = Math.sin(progress * Math.PI * 2) * 15 * intensityFactor;
                        const rollRotation = progress * Math.PI * 4; // 720 degrees
                        tempCtx.translate(rollX, 0);
                        tempCtx.rotate(rollRotation);
                        break;
                    case 'kaleidoscope':
                        const kPhase = (progress * 3) % 3;
                        let kScale = 1, kRotation = progress * Math.PI * 2;
                        if (kPhase < 1) {
                            kScale = 1;
                        } else if (kPhase < 2) {
                            kScale = 0.8;
                            kRotation = progress * Math.PI * 2 + (Math.PI * 2/3);
                        } else {
                            kScale = 1.2;
                            kRotation = progress * Math.PI * 2 + (Math.PI * 4/3);
                        }
                        tempCtx.rotate(kRotation);
                        tempCtx.scale(kScale, kScale);
                        // Note: clip-path would be applied here if canvas supported it
                        break;
                    case 'wobble':
                        const wPhase = (progress * 4) % 4;
                        if (wPhase < 1) {
                            tempCtx.transform(1, 0, 0, 1, 0, 0);
                        } else if (wPhase < 2) {
                            tempCtx.transform(1, Math.tan(5 * intensityFactor * (Math.PI / 180)), 
                                             Math.tan(15 * intensityFactor * (Math.PI / 180)), 1, 0, 0);
                            tempCtx.scale(0.9, 1.1);
                        } else if (wPhase < 3) {
                            tempCtx.transform(1, Math.tan(-3 * intensityFactor * (Math.PI / 180)), 
                                             Math.tan(-10 * intensityFactor * (Math.PI / 180)), 1, 0, 0);
                            tempCtx.scale(1.1, 0.9);
                        } else {
                            tempCtx.transform(1, Math.tan(1 * intensityFactor * (Math.PI / 180)), 
                                             Math.tan(5 * intensityFactor * (Math.PI / 180)), 1, 0, 0);
                            tempCtx.scale(0.95, 1.05);
                        }
                        break;
                    case 'teleport':
                        const tPhase = (progress * 20) % 100;
                        if (tPhase < 15 || tPhase >= 85) {
                            // Visible
                            tempCtx.scale(1, 1);
                            tempCtx.globalAlpha = (settings.opacity / 100);
                        } else if (tPhase < 30) {
                            // Shrinking
                            const shrinkFactor = 1 - ((tPhase - 15) / 15);
                            tempCtx.scale(shrinkFactor, shrinkFactor);
                            tempCtx.globalAlpha = (settings.opacity / 100) * 0.5;
                        } else if (tPhase < 50) {
                            // Hidden, moved right
                            tempCtx.scale(0.1, 0.1);
                            tempCtx.translate(30 * intensityFactor, 0);
                            tempCtx.globalAlpha = 0;
                        } else if (tPhase < 70) {
                            // Hidden, moved left
                            tempCtx.scale(0.1, 0.1);
                            tempCtx.translate(-30 * intensityFactor, 0);
                            tempCtx.globalAlpha = (settings.opacity / 100) * 0.5;
                        } else {
                            // Growing
                            const growFactor = (tPhase - 70) / 15;
                            tempCtx.scale(growFactor, growFactor);
                            tempCtx.globalAlpha = (settings.opacity / 100) * 0.8;
                        }
                        break;
                    case 'pinwheel':
                        tempCtx.rotate(progress * Math.PI * 2);
                        // Note: clip-path would be handled in CSS, can't apply to canvas context directly
                        break;
                    case 'bounce-orbit':
                        let orbitX = 0, orbitY = 0;
                        if (progress < 0.25) {
                            // Top left to top
                            orbitX = -15 * intensityFactor + (progress * 4) * 15 * intensityFactor;
                            orbitY = -15 * intensityFactor - Math.sin(progress * 4 * Math.PI/2) * 5 * intensityFactor;
                        } else if (progress < 0.5) {
                            // Top to top right
                            orbitX = (progress - 0.25) * 4 * 15 * intensityFactor;
                            orbitY = -20 * intensityFactor + Math.sin((progress - 0.25) * 4 * Math.PI/2) * 5 * intensityFactor;
                        } else if (progress < 0.75) {
                            // Top right to bottom
                            orbitX = 15 * intensityFactor - ((progress - 0.5) * 4) * 15 * intensityFactor;
                            orbitY = -15 * intensityFactor + (progress - 0.5) * 4 * 30 * intensityFactor;
                        } else {
                            // Bottom to top left
                            orbitX = -15 * intensityFactor * (progress - 0.75) * 4;
                            orbitY = 15 * intensityFactor - (progress - 0.75) * 4 * 30 * intensityFactor;
                        }
                        tempCtx.translate(orbitX, orbitY);
                        break;
                    case 'vvcool':
                        // Vibrating pulse effect similar to Discord's VVCool
                        const vvScale = 1 + Math.sin(progress * Math.PI * 8) * 0.1 * intensityFactor;
                        const vvRotate = Math.sin(progress * Math.PI * 20) * 2 * intensityFactor * (Math.PI / 180);
                        const vvShiftX = Math.sin(progress * Math.PI * 20) * 2 * intensityFactor;
                        const vvShiftY = Math.cos(progress * Math.PI * 20) * 2 * intensityFactor;
                        tempCtx.translate(vvShiftX, vvShiftY);
                        tempCtx.rotate(vvRotate);
                        tempCtx.scale(vvScale, vvScale);
                        break;
                    case 'neon-flash':
                        // Neon flashing effect
                        const neonOpacity = 0.7 + Math.sin(progress * Math.PI * 10) * 0.3 * intensityFactor;
                        const neonScale = 1 + Math.sin(progress * Math.PI * 8) * 0.05 * intensityFactor;
                        tempCtx.globalAlpha = (settings.opacity / 100) * neonOpacity;
                        tempCtx.scale(neonScale, neonScale);
                        // Would add glow effect via shadow in CSS, simulated here with scale
                        break;
                    case 'spin-zoom':
                        // Spinning zoom in/out
                        const szAngle = progress * Math.PI * 4;
                        const szScale = 0.8 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.4 * intensityFactor;
                        tempCtx.rotate(szAngle);
                        tempCtx.scale(szScale, szScale);
                        break;
                    case 'bounce-wave':
                        // Bouncing with wave distortion
                        const bwY = Math.sin(progress * Math.PI * 2) * -10 * intensityFactor;
                        const bwSkewX = Math.sin(progress * Math.PI * 4) * 8 * intensityFactor * (Math.PI / 180);
                        const bwScaleY = 1 + Math.sin(progress * Math.PI * 2) * 0.15 * intensityFactor;
                        tempCtx.translate(0, bwY);
                        tempCtx.transform(1, 0, Math.tan(bwSkewX), 1, 0, 0);
                        tempCtx.scale(1, bwScaleY);
                        break;
                    case 'hyperspeed':
                        // Very fast vibrations with slight rotations
                        const hsScale = 1 + Math.sin(progress * Math.PI * 8) * 0.1 * intensityFactor;
                        const hsRotate = Math.sin(progress * Math.PI * 20) * 2 * intensityFactor * (Math.PI / 180);
                        const hsShiftX = Math.sin(progress * Math.PI * 20) * 2 * intensityFactor;
                        const hsShiftY = Math.cos(progress * Math.PI * 20) * 2 * intensityFactor;
                        tempCtx.translate(hsShiftX, hsShiftY);
                        tempCtx.rotate(hsRotate);
                        tempCtx.scale(hsScale, hsScale);
                        break;
                    case 'color-pulse':
                        // Apply color pulse (note: this would be handled through a filter in CSS)
                        let hue = (progress * 360) % 360;
                        tempCtx.filter = `hue-rotate(${hue}deg)`;
                        break;
                    case 'pixel-shuffle':
                        const psX = Math.sin(progress * Math.PI * 10) * 3 * intensityFactor;
                        const psY = Math.cos(progress * Math.PI * 10) * 3 * intensityFactor;
                        tempCtx.translate(psX, psY);
                        break;
                    case 'glitch-out':
                        if (Math.random() > 0.7) {
                            const goX = (Math.random() - 0.5) * 10 * intensityFactor;
                            tempCtx.translate(goX, 0);
                            // Would apply clip-path and hue-rotate in CSS
                        }
                        break;
                    case 'liquid':
                        // Simulate liquid effect by scaling parts differently
                        const lqScaleX = 1 + Math.sin(progress * Math.PI * 2) * 0.15 * intensityFactor;
                        const lqScaleY = 1 + Math.cos(progress * Math.PI * 2) * 0.15 * intensityFactor;
                        tempCtx.scale(lqScaleX, lqScaleY);
                        // Would apply border-radius in CSS
                        break;
                    case 'warp-drive':
                        const wdScale = 1 - Math.abs(Math.sin(progress * Math.PI)) * 0.5 * intensityFactor;
                        const wdRotation = progress * Math.PI * 2;
                        tempCtx.rotate(wdRotation);
                        tempCtx.scale(wdScale, wdScale);
                        // Would apply filter effects in CSS
                        break;
                    case 'micro-bounce':
                        const microScale = 1 + Math.sin(progress * Math.PI * 2) * 0.1 * intensityFactor;
                        tempCtx.scale(microScale, microScale);
                        break;
                    case 'shatter':
                        const shatterAngle = progress * Math.PI * 2;
                        const shatterScale = 0.8 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.2 * intensityFactor;
                        tempCtx.rotate(shatterAngle);
                        tempCtx.scale(shatterScale, shatterScale);
                        break;
                    case 'clock':
                        const clockAngle = progress * Math.PI * 2;
                        tempCtx.rotate(clockAngle);
                        break;
                    case 'slime':
                        const slimeY = Math.sin(progress * Math.PI * 2) * -10 * intensityFactor;
                        const slimeRotation = Math.sin(progress * Math.PI * 2) * 2 * intensityFactor * (Math.PI / 180);
                        tempCtx.translate(0, slimeY);
                        tempCtx.rotate(slimeRotation);
                        break;
                    case 'paper-plane':
                        const planeAngle = progress * Math.PI * 2;
                        const planeScale = 1 + Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        tempCtx.rotate(planeAngle);
                        tempCtx.scale(planeScale, planeScale);
                        break;
                    case 'bubble-pop':
                        const bubbleScale = 1 + Math.sin(progress * Math.PI * 2) * 0.1 * intensityFactor;
                        tempCtx.scale(bubbleScale, bubbleScale);
                        break;
                    case 'vibrate':
                        const vibrateScale = 1 + Math.sin(progress * Math.PI * 8) * 0.05 * intensityFactor;
                        tempCtx.scale(vibrateScale, vibrateScale);
                        break;
                    case 'firework':
                        const fireworkScale = 1 + Math.sin(progress * Math.PI * 2) * 0.3 * intensityFactor;
                        tempCtx.scale(fireworkScale, fireworkScale);
                        break;
                    case 'magnet':
                        const magnetAngle = progress * Math.PI * 2;
                        tempCtx.rotate(magnetAngle);
                        break;
                    case 'pulse-rings':
                        const pulseRingsScale = 1 + Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        tempCtx.scale(pulseRingsScale, pulseRingsScale);
                        break;
                    case 'drip':
                        const dripY = Math.sin(progress * Math.PI * 2) * -10 * intensityFactor;
                        tempCtx.translate(0, dripY);
                        break;
                    case 'ricochet':
                        const ricochetAngle = progress * Math.PI * 2;
                        const ricochetScale = 0.8 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.2 * intensityFactor;
                        tempCtx.rotate(ricochetAngle);
                        tempCtx.scale(ricochetScale, ricochetScale);
                        break;
                    case 'flip-3d':
                        const flip3DProgress = progress * 4 % 4;
                        let flip3DY = 0, flip3DRotationY = 0;
                        
                        if (flip3DProgress < 1) {
                            flip3DY = -10 * intensityFactor * Math.sin(flip3DProgress * Math.PI);
                            flip3DRotationY = flip3DProgress * 90;
                        } else if (flip3DProgress < 2) {
                            flip3DRotationY = 90 + (flip3DProgress - 1) * 90;
                        } else if (flip3DProgress < 3) {
                            flip3DY = -10 * intensityFactor * Math.sin((flip3DProgress - 2) * Math.PI);
                            flip3DRotationY = 180 + (flip3DProgress - 2) * 90;
                        } else {
                            flip3DRotationY = 270 + (flip3DProgress - 3) * 90;
                        }
                        
                        tempCtx.translate(0, flip3DY);
                        // Simulate 3D rotation by scaling
                        const flip3DScaleX = Math.abs(Math.cos(flip3DRotationY * Math.PI / 180));
                        tempCtx.scale(flip3DScaleX, 1);
                        break;
                    case 'thunder':
                        const thunderAngle = progress * Math.PI * 2;
                        tempCtx.rotate(thunderAngle);
                        break;
                    case 'tv-static':
                        const tvStaticScale = 1 + Math.sin(progress * Math.PI * 10) * 0.1 * intensityFactor;
                        tempCtx.scale(tvStaticScale, tvStaticScale);
                        break;
                    case 'flip-coin':
                        const flipCoinProgress = progress * 4 % 4;
                        let flipCoinY = 0, flipCoinRotationY = 0;
                        
                        if (flipCoinProgress < 1) {
                            flipCoinY = -10 * intensityFactor * Math.sin(flipCoinProgress * Math.PI);
                            flipCoinRotationY = flipCoinProgress * 90;
                        } else if (flipCoinProgress < 2) {
                            flipCoinRotationY = 90 + (flipCoinProgress - 1) * 90;
                        } else if (flipCoinProgress < 3) {
                            flipCoinY = -10 * intensityFactor * Math.sin((flipCoinProgress - 2) * Math.PI);
                            flipCoinRotationY = 180 + (flipCoinProgress - 2) * 90;
                        } else {
                            flipCoinRotationY = 270 + (flipCoinProgress - 3) * 90;
                        }
                        
                        tempCtx.translate(0, flipCoinY);
                        // Simulate 3D rotation by scaling
                        const flipCoinScaleX = Math.abs(Math.cos(flipCoinRotationY * Math.PI / 180));
                        tempCtx.scale(flipCoinScaleX, 1);
                        break;
                    case 'matrix':
                        const matrixProgress = (progress * 4) % 1;
                        const matrixY = Math.floor(matrixProgress * 4) * 10 * intensityFactor;
                        const matrixOpacity = 1 - (matrixProgress * 0.8);
                        tempCtx.globalAlpha = (settings.opacity / 100) * matrixOpacity;
                        tempCtx.translate(0, matrixY);
                        break;
                    case 'meteor':
                        const meteorProgress = progress % 1;
                        const meteorX = (meteorProgress * 2 - 1) * 20 * intensityFactor;
                        const meteorY = (meteorProgress * 2 - 1) * 20 * intensityFactor;
                        const meteorScale = 0.5 + meteorProgress * 0.5;
                        const meteorOpacity = meteorProgress < 0.2 ? meteorProgress * 5 : 
                                             meteorProgress > 0.8 ? (1 - meteorProgress) * 5 : 1;
                        tempCtx.globalAlpha = (settings.opacity / 100) * meteorOpacity;
                        tempCtx.translate(meteorX, meteorY);
                        tempCtx.rotate(progress * Math.PI * 2);
                        tempCtx.scale(meteorScale, meteorScale);
                        break;
                }
                
                tempCtx.translate(-centerX, -centerY);
            }
            
            tempCtx.globalAlpha = settings.opacity / 100;
            
            // Apply rainbow effect if enabled
            if (rainbowEffect) {
                // Apply rainbow effect to image data (same as in original code)
                const hueRotation = (progress * 360) % 360;
                
                // Create a temporary canvas to apply the hue-rotate
                const effectCanvas = document.createElement('canvas');
                effectCanvas.width = effectiveWidth;
                effectCanvas.height = effectiveHeight;
                const effectCtx = effectCanvas.getContext('2d');
                
                // Draw the frame
                effectCtx.drawImage(frame, 0, 0, effectiveWidth, effectiveHeight);
                
                // Get image data
                const imageData = effectCtx.getImageData(0, 0, effectiveWidth, effectiveHeight);
                const data = imageData.data;
                
                // Apply hue rotation manually to each pixel
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] > 0) { // Only process non-transparent pixels
                        // Convert RGB to HSL
                        const r = data[i] / 255;
                        const g = data[i + 1] / 255;
                        const b = data[i + 2] / 255;
                        
                        const max = Math.max(r, g, b);
                        const min = Math.min(r, g, b);
                        let h, s, l = (max + min) / 2;
                        
                        if (max === min) {
                            h = s = 0; // achromatic
                        } else {
                            const d = max - min;
                            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                            
                            switch (max) {
                                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                                case g: h = (b - r) / d + 2; break;
                                case b: h = (r - g) / d + 4; break;
                            }
                            
                            h /= 6;
                        }
                        
                        // Rotate hue
                        h = (h + hueRotation / 360) % 1;
                        
                        // Convert back to RGB
                        let r1, g1, b1;
                        
                        if (s === 0) {
                            r1 = g1 = b1 = l; // achromatic
                        } else {
                            const hue2rgb = (p, q, t) => {
                                if (t < 0) t += 1;
                                if (t > 1) t -= 1;
                                if (t < 1/6) return p + (q - p) * 6 * t;
                                if (t < 1/2) return q;
                                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                                return p;
                            };
                            
                            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                            const p = 2 * l - q;
                            
                            r1 = hue2rgb(p, q, h + 1/3);
                            g1 = hue2rgb(p, q, h);
                            b1 = hue2rgb(p, q, h - 1/3);
                        }
                        
                        // Put back into data array
                        data[i] = Math.round(r1 * 255);
                        data[i + 1] = Math.round(g1 * 255);
                        data[i + 2] = Math.round(b1 * 255);
                    }
                }
                
                // Put the modified image data back
                effectCtx.putImageData(imageData, 0, 0);
                
                // Draw to main canvas
                tempCtx.drawImage(effectCanvas, x, y, effectiveWidth, effectiveHeight);
            } else {
                // Normal drawing without rainbow effect
                tempCtx.drawImage(frame, x, y, effectiveWidth, effectiveHeight);
            }
            
            tempCtx.restore();
            
            gif.addFrame(tempCanvas, {
                delay: 1000 / (fps * animationSpeed),
                copy: true
            });
        });
    }
    
    // Create and display the preview GIF
    gif.on('finished', blob => {
        // Remove loading indicator
        loadingEl.remove();
        
        // Create a URL for the generated GIF
        previewGif = URL.createObjectURL(blob);
        
        // Display the GIF in an image element
        const previewImg = new Image();
        previewImg.src = previewGif;
        previewImg.width = 112;
        previewImg.height = 112;
        previewImg.style.position = 'absolute';
        previewImg.style.top = '0';
        previewImg.style.left = '0';
        
        // Clear the preview canvas and append the image
        const livePreview = document.getElementById('livePreview');
        while (livePreview.firstChild) {
            if (livePreview.firstChild !== previewCanvas) {
                livePreview.removeChild(livePreview.firstChild);
            } else {
                break;
            }
        }
        livePreview.appendChild(previewImg);
    });
    
    gif.render();
}

document.getElementById('generateGif').onclick = async function() {
    const settings = getImageSettings();
    
    if (frames.length === 0) {
        alert('Please upload some images first!');
        return;
    }

    const fps = parseInt(document.getElementById('fps').value);
    const quality = parseInt(document.getElementById('quality').value);
    const duration = parseInt(document.getElementById('duration').value);
    const totalFrames = fps * duration;
    
    const gif = new GIF({
        workers: 2,
        quality,
        width: 112,
        height: 112,
        workerScript: URL.createObjectURL(gifWorkerBlob),
        transparent: settings.backgroundColor ? null : 0x00000000
    });

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 112;
    tempCanvas.height = 112;
    const tempCtx = tempCanvas.getContext('2d');

    for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
        const progress = frameNum / totalFrames;
        
        frames.forEach((frame) => {
            tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            if (settings.backgroundColor) {
                tempCtx.fillStyle = settings.backgroundColor;
                tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            }
            
            const scale = settings.scale / 100;
            const scaledWidth = tempCanvas.width * scale;
            const scaledHeight = tempCanvas.height * scale;
            const x = (tempCanvas.width - scaledWidth) / 2;
            const y = (tempCanvas.height - scaledHeight) / 2;
            
            const effectiveWidth = scaledWidth;
            const effectiveHeight = scaledHeight;
            
            tempCtx.save();
            
            // Apply animation transforms to the context
            if (selectedAnimation !== 'none') {
                const centerX = x + (effectiveWidth / 2);
                const centerY = y + (effectiveHeight / 2);
                
                tempCtx.translate(centerX, centerY);
                
                const intensityFactor = animationIntensity / 5;
                
                switch(selectedAnimation) {
                    case 'rotate':
                        tempCtx.rotate(progress * Math.PI * 2);
                        break;
                    case 'bounce':
                        const bounceOffset = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        tempCtx.translate(0, bounceOffset);
                        break;
                    case 'fade':
                        tempCtx.globalAlpha = (settings.opacity / 100) * (0.3 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.7);
                        break;
                    case 'shake':
                        const shakeOffset = Math.sin(progress * Math.PI * 4) * 5 * intensityFactor;
                        tempCtx.translate(shakeOffset, 0);
                        break;
                    case 'pulse':
                        const pulseScale = 1 + Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        tempCtx.scale(pulseScale, pulseScale);
                        break;
                    case 'flip':
                        const flipProgress = Math.sin(progress * Math.PI * 2);
                        tempCtx.scale(flipProgress < 0 ? -1 : 1, 1);
                        break;
                    case 'swing':
                        const swingAngle = Math.sin(progress * Math.PI * 2) * 15 * intensityFactor * (Math.PI / 180);
                        tempCtx.rotate(swingAngle);
                        break;
                    case 'zoom':
                        const zoomScale = 1 - Math.abs(Math.sin(progress * Math.PI * 2)) * 0.3 * intensityFactor;
                        tempCtx.scale(zoomScale, zoomScale);
                        break;
                    case 'spin':
                        const spinRotation = progress * Math.PI * 2;
                        const spinScale = 1 - Math.abs(Math.sin(progress * Math.PI)) * 0.2 * intensityFactor;
                        tempCtx.rotate(spinRotation);
                        tempCtx.scale(spinScale, spinScale);
                        break;
                    case 'wiggle':
                        const wiggleAngle = Math.sin(progress * Math.PI * 4) * 10 * intensityFactor * (Math.PI / 180);
                        tempCtx.transform(1, 0, Math.tan(wiggleAngle), 1, 0, 0);
                        break;
                    case 'squeeze':
                        const squeezeX = 1 + Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        const squeezeY = 1 - Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        tempCtx.scale(squeezeX, squeezeY);
                        break;
                    case 'slide':
                        const slideOffset = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        tempCtx.translate(slideOffset, 0);
                        break;
                    case 'glitch':
                        if (progress * 10 % 1 < 0.3) {
                            const glitchX = (Math.random() - 0.5) * 8 * intensityFactor;
                            const glitchY = (Math.random() - 0.5) * 8 * intensityFactor;
                            tempCtx.translate(glitchX, glitchY);
                        }
                        break;
                    case 'bounce-around':
                        // Bounce around corners in a loop
                        const cycle = (progress * 4) % 4;
                        let xOffset = 0, yOffset = 0;
                        
                        if (cycle < 1) { // Top-left to top-right
                            xOffset = cycle * 10 * intensityFactor;
                            yOffset = -5 * intensityFactor;
                        } else if (cycle < 2) { // Top-right to bottom-right
                            xOffset = 10 * intensityFactor;
                            yOffset = (cycle - 1) * 10 * intensityFactor - 5 * intensityFactor;
                        } else if (cycle < 3) { // Bottom-right to bottom
                            xOffset = (3 - cycle) * 10 * intensityFactor;
                            yOffset = 5 * intensityFactor;
                        } else { // Bottom to top-left
                            xOffset = -10 * intensityFactor;
                            yOffset = (4 - cycle) * 10 * intensityFactor - 5 * intensityFactor;
                        }
                        
                        tempCtx.translate(xOffset, yOffset);
                        tempCtx.rotate(-cycle * Math.PI / 2);
                        break;
                    case 'float':
                        const floatY = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        const floatRotation = Math.sin(progress * Math.PI * 2) * 2 * intensityFactor * (Math.PI / 180);
                        tempCtx.translate(0, floatY);
                        tempCtx.rotate(floatRotation);
                        break;
                    case 'spiral':
                        const spiralRotation = progress * Math.PI * 2;
                        const spiralScale = 0.5 + Math.abs(Math.sin(progress * Math.PI)) * 0.5 * intensityFactor;
                        tempCtx.rotate(spiralRotation);
                        tempCtx.scale(spiralScale, spiralScale);
                        break;
                    case 'throb':
                        const throbScale = 1 + Math.sin(progress * Math.PI * 2) * 0.3 * intensityFactor;
                        tempCtx.scale(throbScale, throbScale);
                        tempCtx.globalAlpha = (settings.opacity / 100) * (0.8 + Math.sin(progress * Math.PI * 2) * 0.2);
                        break;
                    case 'heartbeat':
                        const t = progress * 10 % 1;
                        let heartbeatScale = 1;
                        if (t < 0.1) heartbeatScale = 1.2 * intensityFactor;
                        else if (t < 0.2) heartbeatScale = 1.1 * intensityFactor;
                        else if (t < 0.3) heartbeatScale = 1.0;
                        else if (t < 0.4) heartbeatScale = 1.25 * intensityFactor;
                        else if (t < 0.5) heartbeatScale = 1.15 * intensityFactor;
                        tempCtx.scale(heartbeatScale, heartbeatScale);
                        break;
                    case 'jello':
                        const jelloProgress = progress * 4 % 1;
                        const skewX = Math.sin(jelloProgress * Math.PI * 2) * 15 * intensityFactor * (Math.PI / 180);
                        const skewY = Math.sin(jelloProgress * Math.PI * 2) * 5 * intensityFactor * (Math.PI / 180);
                        tempCtx.transform(1, Math.tan(skewY), Math.tan(skewX), 1, 0, 0);
                        break;
                    case 'pendulum':
                        const pendulumAngle = Math.sin(progress * Math.PI * 2) * 20 * intensityFactor * (Math.PI / 180);
                        tempCtx.rotate(pendulumAngle);
                        break;
                    case 'blink':
                        if ((progress * 2) % 1 < 0.5) {
                            tempCtx.globalAlpha = 0;
                        }
                        break;
                    case 'rainbow':
                        // Apply rainbow effect directly to each frame
                        tempCtx.filter = `hue-rotate(${progress * 360}deg)`;
                        break;
                    case 'tornado':
                        const tornadoAngle = progress * Math.PI * 2;
                        const tornadoScale = 0.6 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.4;
                        const tornadoX = Math.sin(progress * Math.PI * 4) * 10 * intensityFactor;
                        tempCtx.rotate(tornadoAngle);
                        tempCtx.scale(tornadoScale, tornadoScale);
                        tempCtx.translate(tornadoX, 0);
                        break;
                    case 'orbit':
                        const orbitAngle = progress * Math.PI * 2;
                        const orbitRadius = 15 * intensityFactor;
                        tempCtx.translate(
                            Math.cos(orbitAngle) * orbitRadius,
                            Math.sin(orbitAngle) * orbitRadius
                        );
                        tempCtx.rotate(-orbitAngle);
                        break;
                    case 'diagonal-bounce':
                        const diagProgress = progress * 4 % 4;
                        let diagX = 0, diagY = 0, diagRotation = 0;
                        
                        if (diagProgress < 1) {
                            diagX = diagY = 0;
                        } else if (diagProgress < 2) {
                            diagX = 15 * intensityFactor;
                            diagY = -15 * intensityFactor;
                            diagRotation = -5 * (diagProgress - 1);
                        } else if (diagProgress < 3) {
                            diagX = -15 * intensityFactor;
                            diagY = 15 * intensityFactor;
                            diagRotation = 5 * (diagProgress - 2);
                        } else {
                            diagX = 15 * intensityFactor;
                            diagY = 15 * intensityFactor;
                            diagRotation = -5 * (diagProgress - 3);
                        }
                        
                        tempCtx.translate(diagX, diagY);
                        tempCtx.rotate(diagRotation * (Math.PI / 180));
                        break;
                    case 'pixelate':
                        const pixelProgress = Math.sin(progress * Math.PI * 2);
                        const pixelScale = 1 - Math.abs(pixelProgress) * 0.4 * intensityFactor;
                        tempCtx.scale(pixelScale, pixelScale);
                        // Note: image-rendering and filter can't be applied to canvas context directly
                        break;
                    case 'sway':
                        const swayProgress = Math.sin(progress * Math.PI * 2);
                        const swayAngle = swayProgress * 10 * intensityFactor * (Math.PI / 180);
                        const swayX = swayProgress * 10 * intensityFactor;
                        tempCtx.transform(1, 0, Math.tan(swayAngle), 1, swayX, 0);
                        break;
                    case 'ripple':
                        const rippleProgress = Math.sin(progress * Math.PI * 2);
                        const rippleScale = 1 + rippleProgress * 0.2 * intensityFactor;
                        // Blur can't be applied directly to canvas context
                        tempCtx.scale(rippleScale, rippleScale);
                        break;
                    case 'split-shift':
                        // Split-shift effect can't be fully recreated in canvas context
                        // We can approximate with small position shifts
                        const splitShiftProgress = progress * 10 % 1;
                        if (splitShiftProgress < 0.25) {
                            tempCtx.translate(-5 * intensityFactor, 0);
                        } else if (splitShiftProgress < 0.5) {
                            tempCtx.translate(0, -5 * intensityFactor);
                        } else if (splitShiftProgress < 0.75) {
                            tempCtx.translate(5 * intensityFactor, 0);
                        } else {
                            tempCtx.translate(0, 5 * intensityFactor);
                        }
                        break;
                    case 'confetti':
                        const confettiAngle = progress * Math.PI * 2;
                        const confettiScale = 0.8 + Math.sin(progress * Math.PI * 4) * 0.2 * intensityFactor;
                        tempCtx.rotate(confettiAngle);
                        tempCtx.scale(confettiScale, confettiScale);
                        // Color changes handled in CSS
                        break;
                    case 'wave':
                        const waveY = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        const waveSkew = Math.sin(progress * Math.PI * 2) * 15 * intensityFactor * (Math.PI / 180);
                        tempCtx.transform(1, 0, Math.tan(waveSkew), 1, 0, waveY);
                        break;
                    case 'jump-rope':
                        const jumpY = Math.abs(Math.sin(progress * Math.PI * 2)) * -15 * intensityFactor;
                        const jumpScale = 1 - Math.abs(Math.sin(progress * Math.PI * 2)) * 0.3 * intensityFactor;
                        const jumpRotation = Math.sin(progress * Math.PI * 2) * 15 * intensityFactor * (Math.PI / 180);
                        tempCtx.translate(0, jumpY);
                        tempCtx.scale(1, jumpScale);
                        tempCtx.rotate(jumpRotation);
                        break;
                    case 'typewriter':
                        // Typewriter effect - implemented through clipping
                        const typeProgress = progress * 4 % 1;
                        const clipWidth = tempCanvas.width * (1 - typeProgress);
                        tempCtx.beginPath();
                        tempCtx.rect(0, 0, clipWidth, tempCanvas.height);
                        tempCtx.clip();
                        break;
                    case 'bounce-flip':
                        const bfProgress = progress * 4 % 4;
                        let bfY = 0, bfRotationY = 0;
                        
                        if (bfProgress < 1) {
                            bfY = -10 * intensityFactor * Math.sin(bfProgress * Math.PI);
                            bfRotationY = bfProgress * 90;
                        } else if (bfProgress < 2) {
                            bfRotationY = 90 + (bfProgress - 1) * 90;
                        } else if (bfProgress < 3) {
                            bfY = -10 * intensityFactor * Math.sin((bfProgress - 2) * Math.PI);
                            bfRotationY = 180 + (bfProgress - 2) * 90;
                        } else {
                            bfRotationY = 270 + (bfProgress - 3) * 90;
                        }
                        
                        tempCtx.translate(0, bfY);
                        // Simulate 3D rotation by scaling
                        const scaleX = Math.abs(Math.cos(bfRotationY * Math.PI / 180));
                        tempCtx.scale(scaleX, 1);
                        break;
                    case 'dizzy':
                        const dizzyAngle = progress * Math.PI * 2;
                        const dizzyScale = 0.8 + Math.sin(progress * Math.PI * 3) * 0.2 * intensityFactor;
                        const dizzyX = Math.sin(progress * Math.PI * 3) * 10 * intensityFactor;
                        tempCtx.rotate(dizzyAngle);
                        tempCtx.scale(dizzyScale, dizzyScale);
                        tempCtx.translate(dizzyX, 0);
                        break;
                    case 'dance':
                        const danceRotation = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor * (Math.PI / 180);
                        const danceY = Math.sin(progress * Math.PI * 2) * -10 * intensityFactor;
                        const danceSkewX = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor * (Math.PI / 180);
                        tempCtx.rotate(danceRotation);
                        tempCtx.transform(1, 0, Math.tan(danceSkewX), 1, 0, danceY);
                        break;
                    case 'elastic':
                        const elasticProgress = progress * 4 % 1;
                        let elasticScaleX = 1, elasticScaleY = 1;
                        
                        if (elasticProgress < 0.25) {
                            elasticScaleX = 1 + elasticProgress * 2 * intensityFactor;
                            elasticScaleY = 1 - elasticProgress * 2 * intensityFactor;
                        } else if (elasticProgress < 0.5) {
                            const t = (elasticProgress - 0.25) * 4;
                            elasticScaleX = 1.5 * intensityFactor - t * intensityFactor;
                            elasticScaleY = 0.5 + t * intensityFactor;
                        } else if (elasticProgress < 0.75) {
                            const t = (elasticProgress - 0.5) * 4;
                            elasticScaleX = 1 - t * intensityFactor;
                            elasticScaleY = 1 + t * intensityFactor;
                        } else {
                            const t = (elasticProgress - 0.75) * 4;
                            elasticScaleX = 0.8 + t * 0.2 * intensityFactor;
                            elasticScaleY = 1.2 - t * 0.2 * intensityFactor;
                        }
                        
                        tempCtx.scale(elasticScaleX, elasticScaleY);
                        break;
                    case 'shadow-play':
                        const shadowX = Math.sin(progress * Math.PI * 2) * 10 * intensityFactor;
                        const shadowRotation = Math.sin(progress * Math.PI * 2) * 5 * intensityFactor * (Math.PI / 180);
                        tempCtx.translate(shadowX, 0);
                        tempCtx.rotate(shadowRotation);
                        // Shadow effect can't be applied directly in canvas context
                        break;
                    case 'bounce-rotate':
                        const brY = Math.sin(progress * Math.PI * 2) * -15 * intensityFactor;
                        const brRotation = progress * Math.PI * 2;
                        tempCtx.translate(0, brY);
                        tempCtx.rotate(brRotation);
                        break;
                    case 'party-mode':
                        const partyPhase = (progress * 5) % 5;
                        if (partyPhase < 1) {
                            tempCtx.scale(1 + 0.1 * intensityFactor, 1 + 0.1 * intensityFactor);
                            tempCtx.rotate(10 * intensityFactor * (Math.PI / 180));
                        } else if (partyPhase < 2) {
                            tempCtx.scale(0.9 * intensityFactor, 0.9 * intensityFactor);
                            tempCtx.translate(5 * intensityFactor, -5 * intensityFactor);
                            tempCtx.rotate(-5 * intensityFactor * (Math.PI / 180));
                        } else if (partyPhase < 3) {
                            tempCtx.scale(1.2 * intensityFactor, 1.2 * intensityFactor);
                            tempCtx.translate(-5 * intensityFactor, 5 * intensityFactor);
                            tempCtx.rotate(15 * intensityFactor * (Math.PI / 180));
                        } else if (partyPhase < 4) {
                            tempCtx.scale(0.8 * intensityFactor, 0.8 * intensityFactor);
                            tempCtx.rotate(-15 * intensityFactor * (Math.PI / 180));
                        } else {
                            tempCtx.scale(1, 1);
                            tempCtx.rotate(0);
                        }
                        break;
                    case 'rolling':
                        const rollX = Math.sin(progress * Math.PI * 2) * 15 * intensityFactor;
                        const rollRotation = progress * Math.PI * 4; // 720 degrees
                        tempCtx.translate(rollX, 0);
                        tempCtx.rotate(rollRotation);
                        break;
                    case 'kaleidoscope':
                        const kPhase = (progress * 3) % 3;
                        let kScale = 1, kRotation = progress * Math.PI * 2;
                        if (kPhase < 1) {
                            kScale = 1;
                        } else if (kPhase < 2) {
                            kScale = 0.8;
                            kRotation = progress * Math.PI * 2 + (Math.PI * 2/3);
                        } else {
                            kScale = 1.2;
                            kRotation = progress * Math.PI * 2 + (Math.PI * 4/3);
                        }
                        tempCtx.rotate(kRotation);
                        tempCtx.scale(kScale, kScale);
                        // Note: clip-path would be applied here if canvas supported it
                        break;
                    case 'wobble':
                        const wPhase = (progress * 4) % 4;
                        if (wPhase < 1) {
                            tempCtx.transform(1, 0, 0, 1, 0, 0);
                        } else if (wPhase < 2) {
                            tempCtx.transform(1, Math.tan(5 * intensityFactor * (Math.PI / 180)), 
                                             Math.tan(15 * intensityFactor * (Math.PI / 180)), 1, 0, 0);
                            tempCtx.scale(0.9, 1.1);
                        } else if (wPhase < 3) {
                            tempCtx.transform(1, Math.tan(-3 * intensityFactor * (Math.PI / 180)), 
                                             Math.tan(-10 * intensityFactor * (Math.PI / 180)), 1, 0, 0);
                            tempCtx.scale(1.1, 0.9);
                        } else {
                            tempCtx.transform(1, Math.tan(1 * intensityFactor * (Math.PI / 180)), 
                                             Math.tan(5 * intensityFactor * (Math.PI / 180)), 1, 0, 0);
                            tempCtx.scale(0.95, 1.05);
                        }
                        break;
                    case 'teleport':
                        const tPhase = (progress * 20) % 100;
                        if (tPhase < 15 || tPhase >= 85) {
                            // Visible
                            tempCtx.scale(1, 1);
                            tempCtx.globalAlpha = (settings.opacity / 100);
                        } else if (tPhase < 30) {
                            // Shrinking
                            const shrinkFactor = 1 - ((tPhase - 15) / 15);
                            tempCtx.scale(shrinkFactor, shrinkFactor);
                            tempCtx.globalAlpha = (settings.opacity / 100) * 0.5;
                        } else if (tPhase < 50) {
                            // Hidden, moved right
                            tempCtx.scale(0.1, 0.1);
                            tempCtx.translate(30 * intensityFactor, 0);
                            tempCtx.globalAlpha = 0;
                        } else if (tPhase < 70) {
                            // Hidden, moved left
                            tempCtx.scale(0.1, 0.1);
                            tempCtx.translate(-30 * intensityFactor, 0);
                            tempCtx.globalAlpha = (settings.opacity / 100) * 0.5;
                        } else {
                            // Growing
                            const growFactor = (tPhase - 70) / 15;
                            tempCtx.scale(growFactor, growFactor);
                            tempCtx.globalAlpha = (settings.opacity / 100) * 0.8;
                        }
                        break;
                    case 'pinwheel':
                        tempCtx.rotate(progress * Math.PI * 2);
                        // Note: clip-path would be handled in CSS, can't apply to canvas context directly
                        break;
                    case 'bounce-orbit':
                        let orbitX = 0, orbitY = 0;
                        if (progress < 0.25) {
                            // Top left to top
                            orbitX = -15 * intensityFactor + (progress * 4) * 15 * intensityFactor;
                            orbitY = -15 * intensityFactor - Math.sin(progress * 4 * Math.PI/2) * 5 * intensityFactor;
                        } else if (progress < 0.5) {
                            // Top to top right
                            orbitX = (progress - 0.25) * 4 * 15 * intensityFactor;
                            orbitY = -20 * intensityFactor + Math.sin((progress - 0.25) * 4 * Math.PI/2) * 5 * intensityFactor;
                        } else if (progress < 0.75) {
                            // Top right to bottom
                            orbitX = 15 * intensityFactor - ((progress - 0.5) * 4) * 15 * intensityFactor;
                            orbitY = -15 * intensityFactor + (progress - 0.5) * 4 * 30 * intensityFactor;
                        } else {
                            // Bottom to top left
                            orbitX = -15 * intensityFactor * (progress - 0.75) * 4;
                            orbitY = 15 * intensityFactor - (progress - 0.75) * 4 * 30 * intensityFactor;
                        }
                        tempCtx.translate(orbitX, orbitY);
                        break;
                    case 'vvcool':
                        // Vibrating pulse effect similar to Discord's VVCool
                        const vvScale = 1 + Math.sin(progress * Math.PI * 8) * 0.1 * intensityFactor;
                        const vvRotate = Math.sin(progress * Math.PI * 20) * 2 * intensityFactor * (Math.PI / 180);
                        const vvShiftX = Math.sin(progress * Math.PI * 20) * 2 * intensityFactor;
                        const vvShiftY = Math.cos(progress * Math.PI * 20) * 2 * intensityFactor;
                        tempCtx.translate(vvShiftX, vvShiftY);
                        tempCtx.rotate(vvRotate);
                        tempCtx.scale(vvScale, vvScale);
                        break;
                    case 'neon-flash':
                        // Neon flashing effect
                        const neonOpacity = 0.7 + Math.sin(progress * Math.PI * 10) * 0.3 * intensityFactor;
                        const neonScale = 1 + Math.sin(progress * Math.PI * 8) * 0.05 * intensityFactor;
                        tempCtx.globalAlpha = (settings.opacity / 100) * neonOpacity;
                        tempCtx.scale(neonScale, neonScale);
                        // Would add glow effect via shadow in CSS, simulated here with scale
                        break;
                    case 'spin-zoom':
                        // Spinning zoom in/out
                        const szAngle = progress * Math.PI * 4;
                        const szScale = 0.8 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.4 * intensityFactor;
                        tempCtx.rotate(szAngle);
                        tempCtx.scale(szScale, szScale);
                        break;
                    case 'bounce-wave':
                        // Bouncing with wave distortion
                        const bwY = Math.sin(progress * Math.PI * 2) * -10 * intensityFactor;
                        const bwSkewX = Math.sin(progress * Math.PI * 4) * 8 * intensityFactor * (Math.PI / 180);
                        const bwScaleY = 1 + Math.sin(progress * Math.PI * 2) * 0.15 * intensityFactor;
                        tempCtx.translate(0, bwY);
                        tempCtx.transform(1, 0, Math.tan(bwSkewX), 1, 0, 0);
                        tempCtx.scale(1, bwScaleY);
                        break;
                    case 'hyperspeed':
                        // Very fast vibrations with slight rotations
                        const hsScale = 1 + Math.sin(progress * Math.PI * 8) * 0.1 * intensityFactor;
                        const hsRotate = Math.sin(progress * Math.PI * 20) * 2 * intensityFactor * (Math.PI / 180);
                        const hsShiftX = Math.sin(progress * Math.PI * 20) * 2 * intensityFactor;
                        const hsShiftY = Math.cos(progress * Math.PI * 20) * 2 * intensityFactor;
                        tempCtx.translate(hsShiftX, hsShiftY);
                        tempCtx.rotate(hsRotate);
                        tempCtx.scale(hsScale, hsScale);
                        break;
                    case 'color-pulse':
                        // Apply color pulse (note: this would be handled through a filter in CSS)
                        let hue = (progress * 360) % 360;
                        tempCtx.filter = `hue-rotate(${hue}deg)`;
                        break;
                    case 'pixel-shuffle':
                        const psX = Math.sin(progress * Math.PI * 10) * 3 * intensityFactor;
                        const psY = Math.cos(progress * Math.PI * 10) * 3 * intensityFactor;
                        tempCtx.translate(psX, psY);
                        break;
                    case 'glitch-out':
                        if (Math.random() > 0.7) {
                            const goX = (Math.random() - 0.5) * 10 * intensityFactor;
                            tempCtx.translate(goX, 0);
                            // Would apply clip-path and hue-rotate in CSS
                        }
                        break;
                    case 'liquid':
                        // Simulate liquid effect by scaling parts differently
                        const lqScaleX = 1 + Math.sin(progress * Math.PI * 2) * 0.15 * intensityFactor;
                        const lqScaleY = 1 + Math.cos(progress * Math.PI * 2) * 0.15 * intensityFactor;
                        tempCtx.scale(lqScaleX, lqScaleY);
                        // Would apply border-radius in CSS
                        break;
                    case 'warp-drive':
                        const wdScale = 1 - Math.abs(Math.sin(progress * Math.PI)) * 0.5 * intensityFactor;
                        const wdRotation = progress * Math.PI * 2;
                        tempCtx.rotate(wdRotation);
                        tempCtx.scale(wdScale, wdScale);
                        // Would apply filter effects in CSS
                        break;
                    case 'micro-bounce':
                        const microScale = 1 + Math.sin(progress * Math.PI * 2) * 0.1 * intensityFactor;
                        tempCtx.scale(microScale, microScale);
                        break;
                    case 'shatter':
                        const shatterAngle = progress * Math.PI * 2;
                        const shatterScale = 0.8 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.2 * intensityFactor;
                        tempCtx.rotate(shatterAngle);
                        tempCtx.scale(shatterScale, shatterScale);
                        break;
                    case 'clock':
                        const clockAngle = progress * Math.PI * 2;
                        tempCtx.rotate(clockAngle);
                        break;
                    case 'slime':
                        const slimeY = Math.sin(progress * Math.PI * 2) * -10 * intensityFactor;
                        const slimeRotation = Math.sin(progress * Math.PI * 2) * 2 * intensityFactor * (Math.PI / 180);
                        tempCtx.translate(0, slimeY);
                        tempCtx.rotate(slimeRotation);
                        break;
                    case 'paper-plane':
                        const planeAngle = progress * Math.PI * 2;
                        const planeScale = 1 + Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        tempCtx.rotate(planeAngle);
                        tempCtx.scale(planeScale, planeScale);
                        break;
                    case 'bubble-pop':
                        const bubbleScale = 1 + Math.sin(progress * Math.PI * 2) * 0.1 * intensityFactor;
                        tempCtx.scale(bubbleScale, bubbleScale);
                        break;
                    case 'vibrate':
                        const vibrateScale = 1 + Math.sin(progress * Math.PI * 8) * 0.05 * intensityFactor;
                        tempCtx.scale(vibrateScale, vibrateScale);
                        break;
                    case 'firework':
                        const fireworkScale = 1 + Math.sin(progress * Math.PI * 2) * 0.3 * intensityFactor;
                        tempCtx.scale(fireworkScale, fireworkScale);
                        break;
                    case 'magnet':
                        const magnetAngle = progress * Math.PI * 2;
                        tempCtx.rotate(magnetAngle);
                        break;
                    case 'pulse-rings':
                        const pulseRingsScale = 1 + Math.sin(progress * Math.PI * 2) * 0.2 * intensityFactor;
                        tempCtx.scale(pulseRingsScale, pulseRingsScale);
                        break;
                    case 'drip':
                        const dripY = Math.sin(progress * Math.PI * 2) * -10 * intensityFactor;
                        tempCtx.translate(0, dripY);
                        break;
                    case 'ricochet':
                        const ricochetAngle = progress * Math.PI * 2;
                        const ricochetScale = 0.8 + Math.abs(Math.sin(progress * Math.PI * 2)) * 0.2 * intensityFactor;
                        tempCtx.rotate(ricochetAngle);
                        tempCtx.scale(ricochetScale, ricochetScale);
                        break;
                    case 'flip-3d':
                        const flip3DProgress = progress * 4 % 4;
                        let flip3DY = 0, flip3DRotationY = 0;
                        
                        if (flip3DProgress < 1) {
                            flip3DY = -10 * intensityFactor * Math.sin(flip3DProgress * Math.PI);
                            flip3DRotationY = flip3DProgress * 90;
                        } else if (flip3DProgress < 2) {
                            flip3DRotationY = 90 + (flip3DProgress - 1) * 90;
                        } else if (flip3DProgress < 3) {
                            flip3DY = -10 * intensityFactor * Math.sin((flip3DProgress - 2) * Math.PI);
                            flip3DRotationY = 180 + (flip3DProgress - 2) * 90;
                        } else {
                            flip3DRotationY = 270 + (flip3DProgress - 3) * 90;
                        }
                        
                        tempCtx.translate(0, flip3DY);
                        // Simulate 3D rotation by scaling
                        const flip3DScaleX = Math.abs(Math.cos(flip3DRotationY * Math.PI / 180));
                        tempCtx.scale(flip3DScaleX, 1);
                        break;
                    case 'thunder':
                        const thunderAngle = progress * Math.PI * 2;
                        tempCtx.rotate(thunderAngle);
                        break;
                    case 'tv-static':
                        const tvStaticScale = 1 + Math.sin(progress * Math.PI * 10) * 0.1 * intensityFactor;
                        tempCtx.scale(tvStaticScale, tvStaticScale);
                        break;
                    case 'flip-coin':
                        const flipCoinProgress = progress * 4 % 4;
                        let flipCoinY = 0, flipCoinRotationY = 0;
                        
                        if (flipCoinProgress < 1) {
                            flipCoinY = -10 * intensityFactor * Math.sin(flipCoinProgress * Math.PI);
                            flipCoinRotationY = flipCoinProgress * 90;
                        } else if (flipCoinProgress < 2) {
                            flipCoinRotationY = 90 + (flipCoinProgress - 1) * 90;
                        } else if (flipCoinProgress < 3) {
                            flipCoinY = -10 * intensityFactor * Math.sin((flipCoinProgress - 2) * Math.PI);
                            flipCoinRotationY = 180 + (flipCoinProgress - 2) * 90;
                        } else {
                            flipCoinRotationY = 270 + (flipCoinProgress - 3) * 90;
                        }
                        
                        tempCtx.translate(0, flipCoinY);
                        // Simulate 3D rotation by scaling
                        const flipCoinScaleX = Math.abs(Math.cos(flipCoinRotationY * Math.PI / 180));
                        tempCtx.scale(flipCoinScaleX, 1);
                        break;
                    case 'matrix':
                        const matrixProgress = (progress * 4) % 1;
                        const matrixY = Math.floor(matrixProgress * 4) * 10 * intensityFactor;
                        const matrixOpacity = 1 - (matrixProgress * 0.8);
                        tempCtx.globalAlpha = (settings.opacity / 100) * matrixOpacity;
                        tempCtx.translate(0, matrixY);
                        break;
                    case 'meteor':
                        const meteorProgress = progress % 1;
                        const meteorX = (meteorProgress * 2 - 1) * 20 * intensityFactor;
                        const meteorY = (meteorProgress * 2 - 1) * 20 * intensityFactor;
                        const meteorScale = 0.5 + meteorProgress * 0.5;
                        const meteorOpacity = meteorProgress < 0.2 ? meteorProgress * 5 : 
                                             meteorProgress > 0.8 ? (1 - meteorProgress) * 5 : 1;
                        tempCtx.globalAlpha = (settings.opacity / 100) * meteorOpacity;
                        tempCtx.translate(meteorX, meteorY);
                        tempCtx.rotate(progress * Math.PI * 2);
                        tempCtx.scale(meteorScale, meteorScale);
                        break;
                }
                
                tempCtx.translate(-centerX, -centerY);
            }
            
            tempCtx.globalAlpha = settings.opacity / 100;
            
            // Apply rainbow effect to image data if enabled
            if (rainbowEffect) {
                const frameImage = new Image();
                frameImage.src = frame.src || createImageBitmap(frame).then(bmp => {
                    const tempCanvas2 = document.createElement('canvas');
                    tempCanvas2.width = bmp.width;
                    tempCanvas2.height = bmp.height;
                    const tempCtx2 = tempCanvas2.getContext('2d');
                    tempCtx2.drawImage(bmp, 0, 0);
                    return tempCanvas2.toDataURL();
                });
                
                const hueRotation = (progress * 360) % 360;
                
                // Create a temporary canvas to apply the hue-rotate
                const effectCanvas = document.createElement('canvas');
                effectCanvas.width = effectiveWidth;
                effectCanvas.height = effectiveHeight;
                const effectCtx = effectCanvas.getContext('2d');
                
                // Draw the frame
                effectCtx.drawImage(frame, 0, 0, effectiveWidth, effectiveHeight);
                
                // Get image data
                const imageData = effectCtx.getImageData(0, 0, effectiveWidth, effectiveHeight);
                const data = imageData.data;
                
                // Apply hue rotation manually to each pixel
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] > 0) { // Only process non-transparent pixels
                        // Convert RGB to HSL
                        const r = data[i] / 255;
                        const g = data[i + 1] / 255;
                        const b = data[i + 2] / 255;
                        
                        const max = Math.max(r, g, b);
                        const min = Math.min(r, g, b);
                        let h, s, l = (max + min) / 2;
                        
                        if (max === min) {
                            h = s = 0; // achromatic
                        } else {
                            const d = max - min;
                            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                            
                            switch (max) {
                                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                                case g: h = (b - r) / d + 2; break;
                                case b: h = (r - g) / d + 4; break;
                            }
                            
                            h /= 6;
                        }
                        
                        // Rotate hue
                        h = (h + hueRotation / 360) % 1;
                        
                        // Convert back to RGB
                        let r1, g1, b1;
                        
                        if (s === 0) {
                            r1 = g1 = b1 = l; // achromatic
                        } else {
                            const hue2rgb = (p, q, t) => {
                                if (t < 0) t += 1;
                                if (t > 1) t -= 1;
                                if (t < 1/6) return p + (q - p) * 6 * t;
                                if (t < 1/2) return q;
                                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                                return p;
                            };
                            
                            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                            const p = 2 * l - q;
                            
                            r1 = hue2rgb(p, q, h + 1/3);
                            g1 = hue2rgb(p, q, h);
                            b1 = hue2rgb(p, q, h - 1/3);
                        }
                        
                        // Put back into data array
                        data[i] = Math.round(r1 * 255);
                        data[i + 1] = Math.round(g1 * 255);
                        data[i + 2] = Math.round(b1 * 255);
                    }
                }
                
                // Put the modified image data back
                effectCtx.putImageData(imageData, 0, 0);
                
                // Draw to main canvas
                tempCtx.drawImage(effectCanvas, x, y, effectiveWidth, effectiveHeight);
            } else {
                // Normal drawing without rainbow effect
                tempCtx.drawImage(frame, x, y, effectiveWidth, effectiveHeight);
            }
            
            tempCtx.restore();
            
            gif.addFrame(tempCanvas, {
                delay: 1000 / (fps * animationSpeed),
                copy: true
            });
        });
    }

    gif.on('finished', blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'twitch-emote.gif';
        link.click();
        
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    });

    gif.render();
};

document.getElementById('clearCanvas').addEventListener('click', () => {
    frames = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('fileInput').value = '';
    selectedAnimation = 'none';
    document.querySelectorAll('.animation-option').forEach(opt => {
        if (opt.dataset.animation !== 'rainbow-effect') {
            opt.classList.remove('selected');
        }
    });
    document.querySelector('[data-animation="none"]').classList.add('selected');
    
    const previewCanvas = document.getElementById('previewAnimation');
    const previewCtx = previewCanvas.getContext('2d');
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewCanvas.style.animation = 'none';
});

// AI Image Generation
document.getElementById('generateImage').addEventListener('click', async () => {
    const prompt = document.getElementById('imagePrompt').value.trim();
    const aspectRatio = document.getElementById('aspectRatio').value;
    const advancedMode = document.getElementById('advancedMode').checked;
    const statusElement = document.getElementById('generationStatus');
    
    if (!prompt) {
        statusElement.textContent = 'Please enter a description for your image.';
        return;
    }
    
    statusElement.innerHTML = '<div class="loading-spinner"></div> Processing your request...';
    
    try {
        let finalPrompt = prompt;
        
        // If advanced mode is enabled, enhance the prompt first
        if (advancedMode) {
            statusElement.innerHTML = '<div class="loading-spinner"></div> Enhancing your prompt...';
            
            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `You are an expert at creating detailed image generation prompts. 
                        Take the user's basic idea and expand it into a rich, detailed description that will 
                        create a visually interesting and high-quality image. Focus on visual details, style, 
                        lighting, mood, and composition. Your output should be just the enhanced prompt with no 
                        explanations or additional text.`
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            });
            
            finalPrompt = completion.content;
            statusElement.innerHTML = '<div class="loading-spinner"></div> Generating image...';
        }
        
        // Generate the image
        const result = await websim.imageGen({
            prompt: finalPrompt,
            aspect_ratio: aspectRatio
        });
        
        // Create a new image from the generated URL
        const img = new Image();
        img.onload = async function() {
            const frame = await createImageBitmap(img);
            frames = [frame]; // Replace existing frames with this new one
            drawPreview(frame);
            updateLivePreview();
            statusElement.textContent = 'Image generated successfully!';
        };
        img.onerror = function() {
            statusElement.textContent = 'Error loading the generated image.';
        };
        img.src = result.url;
        
    } catch (error) {
        console.error('Error generating image:', error);
        statusElement.textContent = `Error: ${error.message || 'Failed to generate image'}`;
    }
});