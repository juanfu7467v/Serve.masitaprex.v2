const express = require("express");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const cors = require('cors');
const { Buffer } = require('buffer');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(cors());

// Configuración
const API_BASE_URL = process.env.API_BASE_URL || "https://serve-masitaprex-v2.fly.dev";
const TRABAJOS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/trabajos";
const EMPRESAS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/empresas";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = "main";

// ==============================================================================
//  FUNCIONES DE GITHUB
// ==============================================================================

const uploadToGitHub = async (fileName, pdfBuffer) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error("Configuración de GitHub incompleta.");
    
    const [owner, repo] = GITHUB_REPO.split('/');
    const filePath = `reports/${fileName}`; 
    const contentBase64 = pdfBuffer.toString('base64');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    try {
        // Primero intentamos ver si existe para obtener el SHA (opcional, aquí lo sobreescribimos)
        let sha;
        try {
            const res = await axios.get(apiUrl, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
            sha = res.data.sha;
        } catch (e) { sha = null; }

        await axios.put(apiUrl, {
            message: `Reporte PDF generado: ${fileName}`,
            content: contentBase64,
            branch: GITHUB_BRANCH,
            sha: sha
        }, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });
        
        return `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;
    } catch (error) {
        console.error("Error GitHub:", error.message);
        throw new Error("Error al subir PDF a GitHub.");
    }
};

// ==============================================================================
//  GENERADOR DE PDF (DISEÑO IGUAL A LA IMAGEN)
// ==============================================================================

const generatePDF = (dni, dataList, apiName) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // --- ENCABEZADO ESTILO IMAGEN ---
        // Texto "Pe" grande
        doc.fillColor('#000000').fontSize(40).font('Helvetica-Bold').text('Pe', 50, 40);
        doc.fontSize(20).text('RESULTADO', 50, 80);

        // Logo derecha (Simulado con texto, puedes usar doc.image si tienes el logo)
        doc.fontSize(10).text('Consulta pe apk', 450, 60, { align: 'right' });
        
        doc.moveDown(2);
        
        // Bloque Información General
        doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text('Información', 50, 140);
        
        const infoY = 160;
        doc.rect(50, infoY, 500, 50).stroke(); // Cuadro exterior
        doc.lineCap('butt').moveTo(300, infoY).lineTo(300, infoY + 50).stroke(); // Divisor medio
        
        doc.fontSize(10).font('Helvetica');
        doc.text(`Fecha de consulta:`, 60, infoY + 10);
        doc.font('Helvetica-Bold').text(new Date().toLocaleDateString(), 150, infoY + 10);
        
        doc.font('Helvetica').text(`DNI Consultado:`, 310, infoY + 10);
        doc.font('Helvetica-Bold').text(dni, 400, infoY + 10);

        // --- TABLA DE RESULTADOS (Asistentes / Orden del día en tu imagen) ---
        doc.moveDown(4);
        doc.fontSize(14).font('Helvetica-Bold').text(`Detalle de ${apiName}`, 50);
        doc.moveDown(1);

        const startX = 50;
        let currentY = doc.y;

        dataList.forEach((item, index) => {
            // Verificar si necesitamos nueva página
            if (currentY > 700) {
                doc.addPage();
                currentY = 50;
            }

            // Diseño de celda
            const rowHeight = 60;
            const isGray = index % 2 === 0;

            if (isGray) {
                doc.fillColor('#f2f2f2').rect(startX, currentY, 500, rowHeight).fill();
            }

            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10);
            
            if (apiName === "TRABAJOS") {
                doc.text(item.rz || "EMPRESA NO IDENTIFICADA", startX + 10, currentY + 10);
                doc.font('Helvetica').text(`RUC: ${item.ruc || 'N/A'} | Inicio: ${item.fip || 'N/A'}`, startX + 10, currentY + 30);
                doc.fillColor('#2e7d32').text(`Estado: ${item.ffp || 'VIGENTE'}`, startX + 10, currentY + 45);
            } else {
                doc.text(item.razon_social || "ENTIDAD NO IDENTIFICADA", startX + 10, currentY + 10);
                doc.font('Helvetica').text(`RUC: ${item.ruc || 'N/A'} | Cargo: ${item.cargo || 'N/A'}`, startX + 10, currentY + 30);
                doc.fillColor('#d32f2f').text(`Desde: ${item.desde || 'N/A'}`, startX + 10, currentY + 45);
            }

            // Bordes de la celda
            doc.fillColor('#000000').rect(startX, currentY, 500, rowHeight).stroke();
            
            currentY += rowHeight;
        });

        doc.fontSize(8).fillColor('#888888').text(`Total de registros: ${dataList.length} - Generado automáticamente`, 50, 780, { align: 'center' });

        doc.end();
    });
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
            return res.status(404).json({ message: "error", detail: "Sin datos" });
        }

        const pdfBuffer = await generatePDF(dni, result.coincidences, "TRABAJOS");
        const fileName = `reporte_${dni}_trabajos.pdf`;
        const githubUrl = await uploadToGitHub(fileName, pdfBuffer);

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
        const response = await axios.get(`${EMPRESAS_API_URL}?dni=${dni}`);
        const result = response.data.result;

        if (!result || !result.coincidences || result.coincidences.length === 0) {
            return res.status(404).json({ message: "error", detail: "Sin datos" });
        }

        const pdfBuffer = await generatePDF(dni, result.coincidences, "EMPRESAS");
        const fileName = `reporte_${dni}_empresas.pdf`;
        const githubUrl = await uploadToGitHub(fileName, pdfBuffer);

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

app.get("/descargar-ficha", async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).send("Falta URL");
    try {
        const response = await axios.get(decodeURIComponent(url), { responseType: 'arraybuffer' });
        res.set('Content-Type', 'application/pdf'); // Cambiado a PDF
        res.send(Buffer.from(response.data));
    } catch (e) { 
        res.status(500).send("Error al descargar el PDF."); 
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Servidor PDF activo en puerto ${PORT}`);
});
