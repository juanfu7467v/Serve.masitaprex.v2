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

// URL base para las descargas de imágenes
const API_BASE_URL = process.env.API_BASE_URL || "https://consulta-pe-imagenes-v2.fly.dev";

// --- URLS DE LAS APIS EXTERNAS ---
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
const BOX_HEIGHT = 200; // Aumentado ligeramente para evitar recortes de texto
const BOX_VERTICAL_SPACING = 25;
const COLOR_SECONDARY_TEXT = '#333333';
const FONT_FAMILY = "sans-serif";

const API_TYPE_MAP = {
    "TRABAJOS": "TRAB",
    "EMPRESAS": "EMP"
};

// ==============================================================================
//  FUNCIONES DE UTILIDAD (GITHUB)
// ==============================================================================

const uploadToGitHub = async (fileName, imageBuffer) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error("GitHub no configurado en variables de entorno.");
    const [owner, repo] = GITHUB_REPO.split('/');
    const filePath = `public/${fileName}`; 
    const contentBase64 = imageBuffer.toString('base64');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const publicUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;

    const data = {
        message: `feat: Reporte automático generado para ${fileName}`,
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

const drawDataBox = (ctx, x, y, title, lines, colorTheme) => {
    const radius = 15;
    ctx.fillStyle = '#ffffff';
    
    // Sombra suave
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.roundRect(x, y, BOX_WIDTH, BOX_HEIGHT, radius);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Borde decorativo lateral
    ctx.fillStyle = colorTheme;
    ctx.fillRect(x, y + 20, 10, BOX_HEIGHT - 40);

    // Título principal (Razón Social)
    ctx.textAlign = 'left';
    ctx.font = `bold 22px ${FONT_FAMILY}`;
    ctx.fillStyle = colorTheme;
    
    // Controlar que el título no se desborde
    const maxTitleWidth = BOX_WIDTH - 60;
    let displayTitle = title.toUpperCase();
    if (ctx.measureText(displayTitle).width > maxTitleWidth) {
        displayTitle = displayTitle.substring(0, 60) + "...";
    }
    ctx.fillText(displayTitle, x + 35, y + 55);

    // Líneas de información
    ctx.font = `19px ${FONT_FAMILY}`;
    ctx.fillStyle = COLOR_SECONDARY_TEXT;
    lines.forEach((line, index) => {
        ctx.fillText(line, x + 35, y + 100 + (index * 35));
    });
};

const generateReportImage = async (dni, dataList, apiName) => {
    const count = dataList.length;
    const headerHeight = 180;
    const footerHeight = 100;
    const totalHeight = headerHeight + (count * (BOX_HEIGHT + BOX_VERTICAL_SPACING)) + footerHeight;

    const canvas = createCanvas(CANVAS_WIDTH, totalHeight);
    const ctx = canvas.getContext("2d");

    // Fondo degradado sutil
    const grad = ctx.createLinearGradient(0, 0, 0, totalHeight);
    grad.addColorStop(0, '#f1f3f5');
    grad.addColorStop(1, '#dee2e6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, totalHeight);

    // Cabecera
    ctx.fillStyle = '#0d47a1';
    ctx.font = `bold 42px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`REPORTE DE ${apiName}`, CANVAS_WIDTH / 2, 80);
    
    ctx.fillStyle = '#333';
    ctx.font = `26px ${FONT_FAMILY}`;
    ctx.fillText(`DOCUMENTO CONSULTADO: ${dni}`, CANVAS_WIDTH / 2, 125);

    let currentY = headerHeight;
    const boxX = (CANVAS_WIDTH - BOX_WIDTH) / 2;

    dataList.forEach((item) => {
        let title = "";
        let lines = [];
        let color = "#0d47a1";

        if (apiName === "TRABAJOS") {
            title = item.rz || "EMPRESA NO IDENTIFICADA";
            lines = [
                `RUC: ${item.ruc || 'N/A'}`,
                `FECHA INICIO: ${item.fip || 'N/A'}`,
                `ESTADO: ${item.ffp || 'VIGENTE'}`
            ];
            color = "#2e7d32"; // Verde
        } else {
            title = item.razon_social || "EMPRESA NO IDENTIFICADA";
            lines = [
                `RUC: ${item.ruc || 'N/A'}`,
                `CARGO: ${item.cargo || 'N/A'}`,
                `OCUPA PUESTO DESDE: ${item.desde || 'N/A'}`
            ];
            color = "#c62828"; // Rojo
        }

        drawDataBox(ctx, boxX, currentY, title, lines, color);
        currentY += BOX_HEIGHT + BOX_VERTICAL_SPACING;
    });

    // Pie de página
    ctx.fillStyle = '#666';
    ctx.font = `italic 18px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Resultados obtenidos automáticamente - Total registros: ${count}`, CANVAS_WIDTH / 2, totalHeight - 50);

    return canvas.toBuffer('image/png');
};

// ==============================================================================
//  ENDPOINTS (CORREGIDOS)
// ==============================================================================

app.get("/consultar-trabajos", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "error", detail: "DNI requerido" });

    try {
        const response = await axios.get(`${TRABAJOS_API_URL}?dni=${dni}`);
        const result = response.data.result;

        if (!result || !result.coincidences || result.coincidences.length === 0) {
            return res.status(404).json({ message: "error", detail: "No se encontraron datos laborales" });
        }

        const apiType = API_TYPE_MAP["TRABAJOS"];
        const existingUrl = await checkIfImageExists(dni, apiType);
        
        if (existingUrl) {
            return res.json({ 
                message: "found data", 
                result: { quantity: result.quantity, url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(existingUrl)}` } 
            });
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
    if (!dni) return res.status(400).json({ message: "error", detail: "DNI requerido" });

    try {
        // CORRECCIÓN: Se cambió EMPREAS_API_URL por EMPRESAS_API_URL
        const response = await axios.get(`${EMPRESAS_API_URL}?dni=${dni}`);
        const result = response.data.result;

        if (!result || !result.coincidences || result.coincidences.length === 0) {
            return res.status(404).json({ message: "error", detail: "No se encontraron datos empresariales" });
        }

        const apiType = API_TYPE_MAP["EMPRESAS"];
        const existingUrl = await checkIfImageExists(dni, apiType);
        
        if (existingUrl) {
            return res.json({ 
                message: "found data", 
                result: { quantity: result.quantity, url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(existingUrl)}` } 
            });
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

// Proxy para descarga directa de imagen
app.get("/descargar-ficha", async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).send("URL faltante");
    try {
        const response = await axios.get(decodeURIComponent(url), { responseType: 'arraybuffer' });
        res.set('Content-Type', 'image/png');
        res.send(Buffer.from(response.data));
    } catch (e) { 
        res.status(500).send("Error al descargar la imagen desde el servidor de almacenamiento."); 
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Servidor de Consultas iniciado en http://${HOST}:${PORT}`);
});
