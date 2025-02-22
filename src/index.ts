import express, { Request, Response } from "express";
import multer from "multer";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { QueueServiceClient } from "@azure/storage-queue";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

// Configuration CORS et parsing JSON
app.use(cors());
app.use(express.json());

// Configuration de l'upload avec multer (max 5MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

// Connexion à Azure Blob Storage
const blobServiceClient = new BlobServiceClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    new StorageSharedKeyCredential(
        process.env.AZURE_STORAGE_ACCOUNT_NAME!,
        process.env.AZURE_STORAGE_ACCOUNT_KEY!
    )
);
const containerClient = blobServiceClient.getContainerClient(process.env.AZURE_STORAGE_CONTAINER_NAME!);

// Connexion à la file d'attente Azure
const queueServiceClient = new QueueServiceClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.queue.core.windows.net`,
    new StorageSharedKeyCredential(
        process.env.AZURE_STORAGE_ACCOUNT_NAME!,
        process.env.AZURE_STORAGE_ACCOUNT_KEY!
    )
);
const queueClient = queueServiceClient.getQueueClient(process.env.AZURE_QUEUE_NAME!);

// Connexion à MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
});

// Endpoint pour l'upload vers Azure Blob Storage
app.post("/upload", upload.single("image"), async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
        res.status(400).json({ error: "Aucun fichier envoyé." });
        return;
    }

    const { width, height } = req.body;
    if (!width || !height) {
        res.status(400).json({ error: "Largeur et hauteur requises." });
        return;
    }

    try {
        const blobName = `${Date.now()}-${req.file.originalname}`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.upload(req.file.buffer, req.file.buffer.length, {
            blobHTTPHeaders: { blobContentType: req.file.mimetype },
        });

        const fileUrl = blockBlobClient.url;

        // Ajout à la file d'attente pour traitement
        const message = JSON.stringify({ fileUrl, width, height });
        await queueClient.sendMessage(Buffer.from(message).toString("base64"));

        // Enregistrement en base de données
        await db.execute(
            "INSERT INTO images (filename, url, width, height, status) VALUES (?, ?, ?, ?, ?)",
            [blobName, fileUrl, width, height, "pending"]
        );

        res.json({ message: "Fichier uploadé et ajouté à la file d'attente.", fileUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur lors de l'upload." });
    }
});

// Endpoint pour lister les images traitées
app.get("/images", async (req: Request, res: Response) => {
    try {
        const [rows] = await db.query("SELECT * FROM images ORDER BY created_at DESC LIMIT 10");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur lors de la récupération des images." });
    }
});

// Servir une page HTML simple pour tester l'upload
app.get("/", (req, res) => {
    res.send(`
        <h2>Upload d'image</h2>
        <form action="/upload" method="post" enctype="multipart/form-data">
            <input type="file" name="image" required />
            <input type="number" name="width" placeholder="Largeur (px)" required />
            <input type="number" name="height" placeholder="Hauteur (px)" required />
            <button type="submit">Envoyer</button>
        </form>
        <h3>Dernières images traitées</h3>
        <ul id="images"></ul>
        <script>
            fetch('/images')
                .then(res => res.json())
                .then(data => {
                    const ul = document.getElementById('images');
                    data.forEach(img => {
                        const li = document.createElement('li');
                        li.innerHTML = \`<a href="\${img.url}" target="_blank">\${img.filename} (\${img.width}x\${img.height})</a> - \${img.status}\`;
                        ul.appendChild(li);
                    });
                });
        </script>
    `);
});

// Démarrer le serveur
app.listen(port, () => {
    console.log(`Serveur en écoute sur http://localhost:${port}`);
});
