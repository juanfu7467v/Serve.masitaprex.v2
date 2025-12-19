const express = require("express");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const QRCode = require('qrcode');
const cors = require('cors');
const { Buffer } = require('buffer');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(cors());

// --- URLS DE LAS APIS ---
const SUELDOS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/sueldos";
const CONSUMOS_API_URL = "https://banckend-poxyv1-cosultape-masitaprex.fly.dev/consumos";
const APK_LINK = "https://apk.e-droid.net/apk/app3790080-1f9e8a.apk?v=2";

// --- Configuración de GitHub ---
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
 * Genera el PDF con posicionamiento dinámico y encabezados personalizados
 */
const generatePDF = async (dni, data, tipo) => {
    const qrDataUrl = await QRCode.toDataURL(APK_LINK);
    const tituloReporte = tipo === 'SUELDOS' ? 'REPORTE DE SUELDOS' : 'REPORTE DE CONSUMOS';

    return new Promise((resolve) => {
        const doc = new PDFDocument({ 
            margin: 40, 
            size: 'A4',
            bufferPages: true 
        });
        
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // --- ENCABEZADO PERSONALIZADO ---
        doc.fontSize(25).font('Helvetica-Bold').fillColor('#000000').text(tituloReporte, 40, 45);
        doc.fontSize(12).font('Helvetica').text('Consultas Pe APK', 40, 80);
        
        // Texto superior derecha
        doc.fontSize(10).font('Helvetica').text('App Oficial', 450, 45, { align: 'right' });

        // --- SECCIÓN: INFORMACIÓN ---
        doc.rect(40, 110, 520, 20).fill('#f0f0f0').stroke('#000000');
        doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold').text('Información de Consulta', 45, 115);

        const infoTop = 130;
        doc.rect(40, infoTop, 130, 25).stroke();
        doc.text('DNI Consultado', 45, infoTop + 7);
        doc.rect(170, infoTop, 130, 25).stroke();
        doc.font('Helvetica').text(dni, 175, infoTop + 7);

        doc.rect(300, infoTop, 100, 25).stroke();
        doc.font('Helvetica-Bold').text('Fecha', 305, infoTop + 7);
        doc.rect(400, infoTop, 160, 25).stroke();
        doc.font('Helvetica').text(new Date().toLocaleDateString(), 405, infoTop + 7);

        // --- TABLA DE RESULTADOS ---
        let currentY = 180;
        doc.rect(40, currentY, 520, 20).fill('#f0f0f0').stroke('#000000');
        doc.fillColor('#000000').font('Helvetica-Bold').text(`Detalle de Registros Encontrados`, 45, currentY + 5);
        
        currentY += 20;
        const col1 = 200;
        const col2 = 320;

        data.forEach((item, index) => {
            // Salto de página si llega al límite inferior
            if (currentY > 740) {
                doc.addPage();
                currentY = 50;
            }

            const isGray = index % 2 === 0;
            if (isGray) doc.rect(40, currentY, 520, 25).fill('#f9f9f9');
            
            doc.fillColor('#000000').stroke('#cccccc');
            doc.rect(40, currentY, col1, 25).stroke();
            doc.rect(40 + col1, currentY, col2, 25).stroke();

            doc.fontSize(8).font('Helvetica');
            
            if (tipo === 'SUELDOS') {
                const nombreEmpresa = (item.empresa || 'N/A').substring(0, 40);
                doc.text(nombreEmpresa, 45, currentY + 8);
                doc.text(`S/ ${item.sueldo}  |  Periodo: ${item.periodo}  |  Sit: ${item.situacion || '-'}`, 45 + col1, currentY + 8);
            } else {
                const razonSocial = (item.razonSocial || 'N/A').substring(0, 40);
                doc.text(razonSocial, 45, currentY + 8);
                doc.text(`S/ ${item.monto}  |  Fecha: ${item.fecha}  |  RUC: ${item.numRucEmisor}`, 45 + col1, currentY + 8);
            }
            currentY += 25;
        });

        // --- FOOTER DINÁMICO (PEGADO A LA TABLA) ---
        // Espacio pequeño entre la tabla y el final
        currentY += 20;

        // Validar si hay espacio para el QR y la renuncia en la misma página
        if (currentY > 700) {
            doc.addPage();
            currentY = 50;
        }

        // Renuncia de responsabilidad (Ajustada a la posición de la tabla)
        doc.fontSize(7).font('Helvetica-Oblique').fillColor('#666666');
        const disclaimer = "Renuncia de responsabilidad: Este documento es de carácter informativo. Los datos provienen de fuentes externas públicas. La aplicación no se responsabiliza por la veracidad o actualización de los mismos ante entidades oficiales.";
        doc.text(disclaimer, 40, currentY, { width: 320, align: 'justify' });

        // QR (Pegado al final de la tabla a la derecha)
        doc.image(qrDataUrl, 460, currentY - 10, { width: 80 });
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000').text('ESCANEA PARA DESCARGAR', 440, currentY + 75, { width: 120, align: 'center' });

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

        const pdfBuffer = await generatePDF(dni, result.result.coincidences ? result.result.coincidences : result.coincidences, "CONSUMOS");
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
