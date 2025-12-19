const express = require("express");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const cors = require('cors');
const { Buffer } = require('buffer');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(cors());

// --- URLS DE LAS APIS ---
const SUELDOS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/sueldos";
const CONSUMOS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/consumos";

// --- Configuración de GitHub (Para guardar el PDF) ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = "main";

/**
 * Función para subir el PDF generado a GitHub
 */
const uploadPDFToGitHub = async (fileName, pdfBuffer) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error("Configuración de GitHub faltante.");
    const [owner, repo] = GITHUB_REPO.split('/');
    const filePath = `reportes/${fileName}`;
    const contentBase64 = pdfBuffer.toString('base64');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    const data = {
        message: `Reporte PDF generado: ${fileName}`,
        content: contentBase64,
        branch: GITHUB_BRANCH
    };

    await axios.put(apiUrl, data, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    return `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${filePath}`;
};

/**
 * Genera el PDF con el diseño de la imagen adjunta
 */
const generatePDF = (dni, data, tipo) => {
    return new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // --- ENCABEZADO Estilo "Pe RESULTADO" ---
        doc.fontSize(40).font('Helvetica-Bold').text('Pe', 40, 40);
        doc.fontSize(20).text('RESULTADO', 40, 85);
        
        // Logo simulado (Consulta pe apk)
        doc.fontSize(10).font('Helvetica').text('Consulta pe apk', 450, 85, { align: 'right' });
        doc.moveTo(450, 80).lineTo(550, 80).stroke(); // Línea decorativa logo

        // --- SECCIÓN: INFORMACIÓN ---
        doc.rect(40, 130, 520, 20).fill('#f0f0f0').stroke('#000000');
        doc.fillColor('#000000').fontSize(12).font('Helvetica-Bold').text('Información General', 45, 135);

        // Tabla de información
        const infoTop = 150;
        doc.rect(40, infoTop, 130, 25).stroke();
        doc.text('DNI Consultado', 45, infoTop + 7);
        doc.rect(170, infoTop, 130, 25).stroke();
        doc.font('Helvetica').text(dni, 175, infoTop + 7);

        doc.rect(300, infoTop, 100, 25).stroke();
        doc.font('Helvetica-Bold').text('Fecha', 305, infoTop + 7);
        doc.rect(400, infoTop, 160, 25).stroke();
        doc.font('Helvetica').text(new Date().toLocaleDateString(), 405, infoTop + 7);

        // --- SECCIÓN: RESULTADOS (Copia el diseño de la tabla de Asistentes) ---
        let currentY = 200;
        doc.rect(40, currentY, 520, 20).fill('#f0f0f0').stroke('#000000');
        doc.fillColor('#000000').font('Helvetica-Bold').text(`Detalle de ${tipo}`, 45, currentY + 5);
        
        currentY += 20;

        // Cabeceras de tabla dinámicas
        const col1 = 200;
        const col2 = 320;

        data.slice(0, 15).forEach((item, index) => {
            const isGray = index % 2 === 0;
            if (isGray) doc.rect(40, currentY, 520, 25).fill('#f9f9f9');
            
            doc.fillColor('#000000').stroke('#cccccc');
            doc.rect(40, currentY, col1, 25).stroke();
            doc.rect(40 + col1, currentY, col2, 25).stroke();

            doc.fontSize(9).font('Helvetica');
            
            if (tipo === 'SUELDOS') {
                doc.text(item.empresa.substring(0, 35), 45, currentY + 8);
                doc.text(`S/ ${item.sueldo} - Período: ${item.periodo}`, 45 + col1, currentY + 8);
            } else {
                doc.text(item.razonSocial.substring(0, 35), 45, currentY + 8);
                doc.text(`S/ ${item.monto} - Fecha: ${item.fecha}`, 45 + col1, currentY + 8);
            }

            currentY += 25;

            // Salto de página si es necesario
            if (currentY > 750) {
                doc.addPage();
                currentY = 40;
            }
        });

        // --- SECCIÓN: ORDEN DEL DÍA (Resumen de Totales) ---
        currentY += 20;
        doc.fontSize(14).font('Helvetica-Bold').text('Resumen del Reporte', 40, currentY);
        currentY += 20;
        
        const totalItems = data.length;
        const resumenText = tipo === 'SUELDOS' ? 'Registros laborales encontrados' : 'Consumos registrados ante SUNAT';
        
        doc.rect(40, currentY, 520, 30).fill('#f0f0f0').stroke('#000000');
        doc.fillColor('#000000').fontSize(10).text(`${resumenText}: ${totalItems}`, 50, currentY + 10);

        doc.end();
    });
};

// --- ENDPOINTS ---

app.get("/consultar-sueldos", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "DNI requerido" });

    try {
        const response = await axios.get(`${SUELDOS_API_URL}?dni=${dni}`);
        const result = response.data.result;
        
        if (!result || result.quantity === 0) throw new Error("Sin datos");

        const pdfBuffer = await generatePDF(dni, result.coincidences, "SUELDOS");
        const fileName = `SUELDO_${dni}_${Date.now()}.pdf`;
        const githubUrl = await uploadPDFToGitHub(fileName, pdfBuffer);

        res.json({
            message: "found data",
            pdf_url: githubUrl,
            quantity: result.quantity
        });
    } catch (e) {
        res.status(500).json({ message: "error", detail: e.message });
    }
});

app.get("/consultar-consumos", async (req, res) => {
    const { dni } = req.query;
    if (!dni) return res.status(400).json({ message: "DNI requerido" });

    try {
        const response = await axios.get(`${CONSUMOS_API_URL}?dni=${dni}`);
        const result = response.data.result;

        if (!result || result.quantity === 0) throw new Error("Sin datos");

        const pdfBuffer = await generatePDF(dni, result.coincidences, "CONSUMOS");
        const fileName = `CONSUMO_${dni}_${Date.now()}.pdf`;
        const githubUrl = await uploadPDFToGitHub(fileName, pdfBuffer);

        res.json({
            message: "found data",
            pdf_url: githubUrl,
            quantity: result.quantity
        });
    } catch (e) {
        res.status(500).json({ message: "error", detail: e.message });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Servidor PDF activo en http://${HOST}:${PORT}`);
});
