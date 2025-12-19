const express = require("express");
const axios = require("axios");
const { createCanvas, loadImage } = require("canvas");
const { v4: uuidv4 } = require("uuid");
const cors = require('cors'); 
const { Buffer } = require('buffer'); 
const path = require('path'); 
const crypto = require('crypto'); 

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(cors()); 

const API_BASE_URL = process.env.API_BASE_URL || "https://consulta-pe-imagenes-v2.fly.dev";

// --- NUEVAS URLS DE LAS APIS ---
const TRABAJOS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/trabajos"; 
const EMPRESAS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/empresas"; 

// --- Configuración de GitHub ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = "main";

// --- Constantes de Diseño ---
const CANVAS_WIDTH = 1080; 
const MARGIN = 30;
const BOX_WIDTH = 900; 
const BOX_VERTICAL_SPACING = 20;
const AVATAR_SIZE = 80;

const COLOR_TITLE = '#000000';
const COLOR_TEXT = '#000000';
const FONT_FAMILY = "sans-serif";

const API_TYPE_MAP = {
    "TRABAJOS": "TRAB",
    "EMPRESAS": "EMPR",
};

// ==============================================================================
//  FUNCIONES DE UTILIDAD Y TEXTO
// ==============================================================================

const generateColorFromText = (text) => {
    if (!text) return '#333333';
    const hash = crypto.createHash('sha256').update(text.toString()).digest('hex').substring(0, 6);
    return `#${hash}`;
};

/**
 * Divide un texto en varias líneas según un ancho máximo.
 */
function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

const uploadToGitHub = async (fileName, imageBuffer) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error("Configuración de GitHub faltante.");
    const [owner, repo] = GITHUB_REPO.split('/');
    const filePath = `public/${fileName}`; 
    const contentBase64 = imageBuffer.toString('base64');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    const data = {
        message: `feat: Imagen generada ${fileName}`,
        content: contentBase64,
        branch: GITHUB_BRANCH
    };

    await axios.put(apiUrl, data, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'FlyIoImageGeneratorApp' }
    });
    return `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;
};

const checkIfImageExists = async (dni, apiType) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return null;
    const [owner, repo] = GITHUB_REPO.split('/');
    const targetFileName = `${dni}_${apiType}.png`.toLowerCase();
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/public/`;

    try {
        const response = await axios.get(apiUrl, {
            headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'FlyIoImageGeneratorApp' }
        });
        const existingFile = response.data.find(file => file.name.toLowerCase() === targetFileName);
        return existingFile ? `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/public/${existingFile.name}` : null;
    } catch (e) { return null; }
};

const uploadOrReturnExisting = async (dni, apiName, imageBuffer) => {
    const apiTypeKey = API_TYPE_MAP[apiName] || 'DATA';
    const existingUrl = await checkIfImageExists(dni, apiTypeKey);
    if (existingUrl) return { url: existingUrl, status: "existing" };

    const fileName = `${dni}_${apiTypeKey}.png`.toLowerCase();
    const newUrl = await uploadToGitHub(fileName, imageBuffer);
    return { url: newUrl, status: "new" };
};

// ==============================================================================
//  FUNCIONES DE DIBUJO
// ==============================================================================

const drawBackground = (ctx, canvasWidth, canvasHeight) => {
    const gradient = ctx.createRadialGradient(canvasWidth/2, canvasHeight/2, 100, canvasWidth/2, canvasHeight/2, canvasWidth*0.7);
    gradient.addColorStop(0, '#E1BEE7');
    gradient.addColorStop(0.5, '#E3F2FD');
    gradient.addColorStop(1, '#E8F5E9');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
};

/**
 * Dibuja una caja que se adapta al contenido
 */
const drawDataBox = (ctx, data, startX, startY, isWorkApi) => {
    let title = isWorkApi ? (data.rz || "N/A") : (data.razon_social || "N/A");
    let subtitle1 = isWorkApi ? `RUC: ${data.ruc}` : `CARGO: ${data.cargo}`;
    let subtitle2 = isWorkApi ? `INICIO: ${data.fip}` : `DESDE: ${data.desde}`;
    let subtitle3 = isWorkApi ? `ESTADO: ${data.ffp}` : `DOC: ${data.tipo_documento} ${data.nro_documento}`;
    let extraInfo = isWorkApi ? "" : `NOMBRES: ${data.nombres}`;

    const textMaxWidth = BOX_WIDTH - (MARGIN * 3) - AVATAR_SIZE;
    const lineHeight = 28;

    // Calcular líneas del título (que suele ser el más largo)
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    const titleLines = wrapText(ctx, title, textMaxWidth);
    
    // Calcular líneas de los subtítulos
    ctx.font = `18px ${FONT_FAMILY}`;
    const s1Lines = wrapText(ctx, subtitle1, textMaxWidth);
    const s2Lines = wrapText(ctx, subtitle2, textMaxWidth);
    const s3Lines = wrapText(ctx, subtitle3, textMaxWidth);
    const extraLines = extraInfo ? wrapText(ctx, extraInfo, textMaxWidth) : [];

    // Calcular altura total necesaria
    const totalLinesCount = titleLines.length + s1Lines.length + s2Lines.length + s3Lines.length + extraLines.length;
    const dynamicBoxHeight = (totalLinesCount * lineHeight) + 60; // 60px de padding vertical

    // Dibujar Caja
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(startX, startY, BOX_WIDTH, dynamicBoxHeight, 12);
    ctx.fill();

    const gradient = ctx.createLinearGradient(startX, startY, startX + BOX_WIDTH, startY + dynamicBoxHeight);
    gradient.addColorStop(0, '#42A5F5');
    gradient.addColorStop(1, '#66BB6A');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Avatar
    const avatarCenterX = startX + MARGIN + AVATAR_SIZE/2;
    const avatarCenterY = startY + (dynamicBoxHeight / 2);
    ctx.fillStyle = generateColorFromText(title);
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, AVATAR_SIZE/2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 30px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(title.charAt(0).toUpperCase(), avatarCenterX, avatarCenterY + 10);

    // Dibujar Textos Linea por Linea
    const textStartX = startX + MARGIN * 2 + AVATAR_SIZE;
    let textCursorY = startY + 40;
    ctx.textAlign = 'left';

    // Título
    ctx.fillStyle = '#1976D2';
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    titleLines.forEach(line => {
        ctx.fillText(line, textStartX, textCursorY);
        textCursorY += lineHeight;
    });

    // Subtítulos
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = `18px ${FONT_FAMILY}`;
    [s1Lines, s2Lines, s3Lines, extraLines].forEach(linesGroup => {
        linesGroup.forEach(line => {
            ctx.fillText(line, textStartX, textCursorY);
            textCursorY += lineHeight;
        });
    });

    return dynamicBoxHeight;
};

const generateReportImage = async (dni, list, titleText, isWorkApi) => {
    const HEADER_HEIGHT = 160;
    const FOOTER_HEIGHT = 100;
    const boxStartX = (CANVAS_WIDTH - BOX_WIDTH) / 2;

    // Primer pase: calcular la altura total del canvas
    const tempCanvas = createCanvas(CANVAS_WIDTH, 100);
    const tempCtx = tempCanvas.getContext("2d");
    let totalNeededHeight = HEADER_HEIGHT + FOOTER_HEIGHT;

    for (const item of list) {
        // Simulamos el dibujo para obtener la altura
        const h = drawDataBox(tempCtx, item, 0, 0, isWorkApi);
        totalNeededHeight += h + BOX_VERTICAL_SPACING;
    }

    // Segundo pase: Dibujar realmente
    const canvas = createCanvas(CANVAS_WIDTH, Math.max(totalNeededHeight, 800));
    const ctx = canvas.getContext("2d");

    drawBackground(ctx, CANVAS_WIDTH, canvas.height);

    // Header
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 40px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`REPORTE DE ${titleText}`, CANVAS_WIDTH/2, 70);
    ctx.font = `bold 28px ${FONT_FAMILY}`;
    ctx.fillText(`DNI CONSULTADO: ${dni}`, CANVAS_WIDTH/2, 115);

    let currentY = HEADER_HEIGHT;
    for (const item of list) {
        const boxHeight = drawDataBox(ctx, item, boxStartX, currentY, isWorkApi);
        currentY += boxHeight + BOX_VERTICAL_SPACING;
    }

    // Footer
    const footerY = canvas.height - 40;
    ctx.fillStyle = COLOR_TITLE;
    ctx.font = `bold 22px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(`SISTEMA DE CONSULTA ${titleText}`, MARGIN * 2, footerY);
    ctx.textAlign = 'right';
    ctx.fillText(`TOTAL REGISTROS: ${list.length}`, CANVAS_WIDTH - (MARGIN * 2), footerY);

    return canvas.toBuffer('image/png');
};

// ==============================================================================
//  ENDPOINTS
// ==============================================================================

app.get("/consultar-trabajos", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "DNI requerido" });

    try {
        const response = await axios.get(`${TRABAJOS_API_URL}?dni=${dni}`);
        const data = response.data;
        if (data.message !== "found data") throw new Error("No se encontraron datos");

        const buffer = await generateReportImage(dni, data.result.coincidences, "TRABAJOS", true);
        const { url, status } = await uploadOrReturnExisting(dni, "TRABAJOS", buffer);

        res.json({
            message: "found data",
            result: {
                quantity: data.result.quantity,
                coincidences: [{ message: `Reporte generado (${status})`, url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(url)}` }]
            }
        });
    } catch (e) {
        res.status(500).json({ message: "error", detail: e.message });
    }
});

app.get("/consultar-empresas", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "DNI requerido" });

    try {
        const response = await axios.get(`${EMPRESAS_API_URL}?dni=${dni}`);
        const data = response.data;
        if (data.message !== "found data") throw new Error("No se encontraron datos");

        const buffer = await generateReportImage(dni, data.result.coincidences, "EMPRESAS", false);
        const { url, status } = await uploadOrReturnExisting(dni, "EMPRESAS", buffer);

        res.json({
            message: "found data",
            result: {
                quantity: data.result.quantity,
                coincidences: [{ message: `Reporte generado (${status})`, url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(url)}` }]
            }
        });
    } catch (e) {
        res.status(500).json({ message: "error", detail: e.message });
    }
});

app.get("/descargar-ficha", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send("URL faltante");
    try {
        const response = await axios.get(decodeURIComponent(url), { responseType: 'arraybuffer' });
        res.set('Content-Type', 'image/png');
        res.send(Buffer.from(response.data));
    } catch (e) { res.status(500).send(e.message); }
});

app.listen(PORT, HOST, () => {
    console.log(`Servidor activo en http://${HOST}:${PORT}`);
});
