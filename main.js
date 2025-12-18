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
const MARGIN = 40;
const BOX_WIDTH = 950; 
const BOX_HEIGHT = 180; 
const BOX_VERTICAL_SPACING = 20;
const COLOR_TEXT = '#000000';
const COLOR_SECONDARY_TEXT = '#333333';
const FONT_FAMILY = "sans-serif";

const API_TYPE_MAP = {
    "TRABAJOS": "TRAB",
    "EMPRESAS": "EMP"
};

// ==============================================================================
//  FUNCIONES DE UTILIDAD
// ==============================================================================

const uploadToGitHub = async (fileName, imageBuffer) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error("GitHub no configurado.");
    const [owner, repo] = GITHUB_REPO.split('/');
    const filePath = `public/${fileName}`; 
    const contentBase64 = imageBuffer.toString('base64');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const publicUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;

    const data = {
        message: `feat: Reporte generado para ${fileName}`,
        content: contentBase64,
        branch: GITHUB_BRANCH
    };

    await axios.put(apiUrl, data, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'FlyIoApp' }
    });
    return publicUrl;
};

const checkIfImageExists = async (dni, apiType) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return null;
    const [owner, repo] = GITHUB_REPO.split('/');
    const targetFileName = `${dni}_${apiType}.png`.toLowerCase();
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/public/`;

    try {
        const response = await axios.get(apiUrl, {
            headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'FlyIoApp' }
        });
        const existingFile = response.data.find(file => file.name.toLowerCase() === targetFileName);
        return existingFile ? `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/public/${existingFile.name}` : null;
    } catch (e) { return null; }
};

// ==============================================================================
//  LÓGICA DE DIBUJO
// ==============================================================================

const drawBackground = (ctx, width, height) => {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#f8f9fa');
    grad.addColorStop(1, '#e9ecef');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
};

const drawDataBox = (ctx, x, y, title, lines, colorTheme) => {
    const radius = 15;
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    
    // Dibujar caja
    ctx.beginPath();
    ctx.roundRect(x, y, BOX_WIDTH, BOX_HEIGHT, radius);
    ctx.fill();
    ctx.shadowBlur = 0; // Reset shadow

    // Borde lateral de color
    ctx.fillStyle = colorTheme;
    ctx.fillRect(x, y + 20, 8, BOX_HEIGHT - 40);

    // Título (Razón Social o Empresa)
    ctx.textAlign = 'left';
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.fillStyle = colorTheme;
    ctx.fillText(title.toUpperCase(), x + 30, y + 50);

    // Líneas de datos
    ctx.font = `18px ${FONT_FAMILY}`;
    ctx.fillStyle = COLOR_SECONDARY_TEXT;
    lines.forEach((line, index) => {
        ctx.fillText(line, x + 30, y + 90 + (index * 30));
    });
};

// ==============================================================================
//  GENERADOR DE IMÁGENES
// ==============================================================================

const generateReportImage = async (dni, dataList, apiName) => {
    const count = dataList.length;
    const headerHeight = 150;
    const footerHeight = 80;
    const totalHeight = headerHeight + (count * (BOX_HEIGHT + BOX_VERTICAL_SPACING)) + footerHeight + 100;

    const canvas = createCanvas(CANVAS_WIDTH, totalHeight);
    const ctx = canvas.getContext("2d");

    drawBackground(ctx, CANVAS_WIDTH, totalHeight);

    // Cabecera
    ctx.fillStyle = '#1a237e';
    ctx.font = `bold 40px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`REPORTE: ${apiName}`, CANVAS_WIDTH / 2, 70);
    ctx.font = `25px ${FONT_FAMILY}`;
    ctx.fillText(`DOCUMENTO CONSULTADO: ${dni}`, CANVAS_WIDTH / 2, 110);

    let currentY = headerHeight;
    const boxX = (CANVAS_WIDTH - BOX_WIDTH) / 2;

    dataList.forEach((item) => {
        let title = "";
        let lines = [];
        let color = "#1a237e";

        if (apiName === "TRABAJOS") {
            title = item.rz || "SIN RAZÓN SOCIAL";
            lines = [
                `RUC: ${item.ruc}`,
                `INICIO: ${item.fip}`,
                `ESTADO: ${item.ffp}`
            ];
            color = "#2e7d32"; // Verde para trabajos
        } else {
            title = item.razon_social || "EMPRESA";
            lines = [
                `RUC: ${item.ruc}`,
                `CARGO: ${item.cargo}`,
                `DESDE: ${item.desde}`
            ];
            color = "#c62828"; // Rojo para empresas
        }

        drawDataBox(ctx, boxX, currentY, title, lines, color);
        currentY += BOX_HEIGHT + BOX_VERTICAL_SPACING;
    });

    // Pie de página
    ctx.fillStyle = '#555';
    ctx.font = `italic 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Generado automáticamente - Total de registros: ${count}`, CANVAS_WIDTH / 2, totalHeight - 40);

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
        const result = response.data.result;

        if (!result || result.quantity === 0) {
            return res.status(404).json({ message: "No se encontraron datos" });
        }

        const apiType = API_TYPE_MAP["TRABAJOS"];
        const existingUrl = await checkIfImageExists(dni, apiType);
        
        if (existingUrl) {
            return res.json({ message: "found data", result: { quantity: result.quantity, url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(existingUrl)}` } });
        }

        const buffer = await generateReportImage(dni, result.coincidences, "TRABAJOS");
        const fileName = `${dni}_${apiType}.png`.toLowerCase();
        const githubUrl = await uploadToGitHub(fileName, buffer);

        res.json({
            message: "found data",
            result: {
                quantity: result.quantity,
                url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(githubUrl)}`
            }
        });
    } catch (error) {
        res.status(500).json({ message: "error", detail: error.message });
    }
});

app.get("/consultar-empresas", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "DNI requerido" });

    try {
        const response = await axios.get(`${EMPREAS_API_URL}?dni=${dni}`);
        const result = response.data.result;

        if (!result || result.quantity === 0) {
            return res.status(404).json({ message: "No se encontraron datos" });
        }

        const apiType = API_TYPE_MAP["EMPRESAS"];
        const existingUrl = await checkIfImageExists(dni, apiType);
        
        if (existingUrl) {
            return res.json({ message: "found data", result: { quantity: result.quantity, url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(existingUrl)}` } });
        }

        const buffer = await generateReportImage(dni, result.coincidences, "EMPRESAS");
        const fileName = `${dni}_${apiType}.png`.toLowerCase();
        const githubUrl = await uploadToGitHub(fileName, buffer);

        res.json({
            message: "found data",
            result: {
                quantity: result.quantity,
                url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(githubUrl)}`
            }
        });
    } catch (error) {
        res.status(500).json({ message: "error", detail: error.message });
    }
});

// Proxy de descarga
app.get("/descargar-ficha", async (req, res) => {
    let { url } = req.query;
    try {
        const response = await axios.get(decodeURIComponent(url), { responseType: 'arraybuffer' });
        res.set('Content-Type', 'image/png');
        res.send(Buffer.from(response.data));
    } catch (e) { res.status(500).send("Error descarga"); }
});

app.listen(PORT, HOST, () => console.log(`Servidor activo en puerto ${PORT}`));
