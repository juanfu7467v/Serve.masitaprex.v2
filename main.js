const express = require("express");
const axios = require("axios");
const { createCanvas, loadImage } = require("canvas");
const cors = require('cors'); 
const { Buffer } = require('buffer'); 
const path = require('path'); 
const crypto = require('crypto'); 

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(cors()); 

// URL base para el proxy de descarga (Asegúrate que esta URL sea la de tu App en Fly.io)
const API_BASE_URL = process.env.API_BASE_URL || "https://serve-masitaprex-v2.fly.dev";

// --- URLS DE LAS APIS EXTERNAS ---
const TRABAJOS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/trabajos";
const EMPRESAS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/empresas";

// --- Configuración de GitHub (Se obtienen de las variables de entorno) ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = "main";

// --- Constantes de Diseño ---
const CANVAS_WIDTH = 1080; 
const MARGIN = 40;
const BOX_WIDTH = 950; 
const BOX_HEIGHT = 200; // Aumentado ligeramente para evitar recortes
const BOX_VERTICAL_SPACING = 25;
const FONT_FAMILY = "sans-serif";

// ==============================================================================
//  FUNCIONES DE UTILIDAD Y GITHUB
// ==============================================================================

const uploadToGitHub = async (fileName, imageBuffer) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error("Configuración de GitHub incompleta (Token/Repo).");
    
    const [owner, repo] = GITHUB_REPO.split('/');
    const filePath = `public/${fileName}`; 
    const contentBase64 = imageBuffer.toString('base64');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const publicUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;

    const data = {
        message: `Reporte generado: ${fileName}`,
        content: contentBase64,
        branch: GITHUB_BRANCH
    };

    try {
        await axios.put(apiUrl, data, {
            headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'FlyIoApp' }
        });
        return publicUrl;
    } catch (error) {
        console.error("Error subiendo a GitHub:", error.response?.data || error.message);
        throw new Error("No se pudo subir la imagen a GitHub.");
    }
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
    
    // Sombra
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.fillStyle = '#ffffff';
    
    // Caja
    ctx.beginPath();
    ctx.roundRect(x, y, BOX_WIDTH, BOX_HEIGHT, radius);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Borde de color lateral
    ctx.fillStyle = colorTheme;
    ctx.fillRect(x, y + 20, 10, BOX_HEIGHT - 40);

    // Título Principal
    ctx.textAlign = 'left';
    ctx.font = `bold 26px ${FONT_FAMILY}`;
    ctx.fillStyle = colorTheme;
    ctx.fillText(title.toUpperCase(), x + 40, y + 60);

    // Líneas de Datos
    ctx.font = `20px ${FONT_FAMILY}`;
    ctx.fillStyle = '#333333';
    lines.forEach((line, index) => {
        ctx.fillText(line, x + 40, y + 105 + (index * 35));
    });
};

const generateReportImage = async (dni, dataList, apiName) => {
    const count = dataList.length;
    const headerHeight = 180;
    const footerHeight = 100;
    const totalHeight = headerHeight + (count * (BOX_HEIGHT + BOX_VERTICAL_SPACING)) + footerHeight;

    const canvas = createCanvas(CANVAS_WIDTH, totalHeight);
    const ctx = canvas.getContext("2d");

    // Fondo
    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(0, 0, CANVAS_WIDTH, totalHeight);

    // Encabezado
    ctx.fillStyle = apiName === "TRABAJOS" ? "#1b5e20" : "#b71c1c";
    ctx.font = `bold 45px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`REPORTE DE ${apiName}`, CANVAS_WIDTH / 2, 80);
    
    ctx.fillStyle = '#555555';
    ctx.font = `bold 28px ${FONT_FAMILY}`;
    ctx.fillText(`DNI CONSULTADO: ${dni}`, CANVAS_WIDTH / 2, 130);

    let currentY = headerHeight;
    const boxX = (CANVAS_WIDTH - BOX_WIDTH) / 2;

    dataList.forEach((item) => {
        let title = "";
        let lines = [];
        let color = "";

        if (apiName === "TRABAJOS") {
            title = item.rz || "EMPRESA NO IDENTIFICADA";
            lines = [
                `RUC: ${item.ruc || 'N/A'}`,
                `FECHA INICIO: ${item.fip || 'N/A'}`,
                `ESTADO: ${item.ffp || 'VIGENTE'}`
            ];
            color = "#2e7d32";
        } else {
            title = item.razon_social || "ENTIDAD NO IDENTIFICADA";
            lines = [
                `RUC: ${item.ruc || 'N/A'}`,
                `CARGO: ${item.cargo || 'N/A'}`,
                `DESDE: ${item.desde || 'N/A'}`
            ];
            color = "#d32f2f";
        }

        drawDataBox(ctx, boxX, currentY, title, lines, color);
        currentY += BOX_HEIGHT + BOX_VERTICAL_SPACING;
    });

    // Pie de página
    ctx.fillStyle = '#888888';
    ctx.font = `italic 18px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Total de registros: ${count} | Generado por Sistema Consulta PE`, CANVAS_WIDTH / 2, totalHeight - 40);

    return canvas.toBuffer('image/png');
};

// ==============================================================================
//  ENDPOINTS
// ==============================================================================

app.get("/consultar-trabajos", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "error", detail: "DNI requerido" });

    try {
        const response = await axios.get(`${TRABAJOS_API_URL}?dni=${dni}`);
        const result = response.data.result;

        if (!result || !result.coincidences || result.coincidences.length === 0) {
            return res.status(404).json({ message: "error", detail: "No se encontraron trabajos para este DNI" });
        }

        const apiType = "TRAB";
        const existingUrl = await checkIfImageExists(dni, apiType);
        
        if (existingUrl) {
            return res.json({ 
                message: "found data", 
                result: { 
                    quantity: result.quantity, 
                    url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(existingUrl)}` 
                } 
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
        console.error("Error en Trabajos:", error.message);
        res.status(500).json({ message: "error", detail: error.message });
    }
});

app.get("/consultar-empresas", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "error", detail: "DNI requerido" });

    try {
        const response = await axios.get(`${EMPRESAS_API_URL}?dni=${dni}`);
        const result = response.data.result;

        if (!result || !result.coincidences || result.coincidences.length === 0) {
            return res.status(404).json({ message: "error", detail: "No se encontraron empresas para este DNI" });
        }

        const apiType = "EMP";
        const existingUrl = await checkIfImageExists(dni, apiType);
        
        if (existingUrl) {
            return res.json({ 
                message: "found data", 
                result: { 
                    quantity: result.quantity, 
                    url: `${API_BASE_URL}/descargar-ficha?url=${encodeURIComponent(existingUrl)}` 
                } 
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
        console.error("Error en Empresas:", error.message);
        res.status(500).json({ message: "error", detail: error.message });
    }
});

// Proxy de descarga para evitar problemas de CORS y visualización
app.get("/descargar-ficha", async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).send("Falta URL");
    try {
        const response = await axios.get(decodeURIComponent(url), { responseType: 'arraybuffer' });
        res.set('Content-Type', 'image/png');
        res.send(Buffer.from(response.data));
    } catch (e) { 
        res.status(500).send("Error al descargar la imagen desde GitHub."); 
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Servidor activo en http://${HOST}:${PORT}`);
});
