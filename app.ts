// Importation des modules
import express, {Request, Response} from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
const port = process.env.PORT || 3000;

// Configuration du stockage des fichiers uploadés
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});
const upload = multer({ storage });

// Servir une page HTML simple
app.get("/", (req, res) => {
    res.send(`
        <h2>Upload d'image</h2>
        <form action="/upload" method="post" enctype="multipart/form-data">
            <input type="file" name="image" required />
            <button type="submit">Envoyer</button>
        </form>
    `);
});

// Endpoint pour l'upload
app.post("/upload", upload.single("image"), (req: Request, res: Response) : void => {
    if (!req.file) {
        res.status(400).send("Aucun fichier envoyé.");
        return;
    }
    res.send(`Fichier uploadé : <a href="/${req.file.path}">${req.file.filename}</a>`);
});

// Servir les fichiers uploadés
app.use("/uploads", express.static(uploadDir));

// Démarrer le serveur
app.listen(port, () => {
    console.log(`Serveur en écoute sur http://localhost:${port}`);
});
