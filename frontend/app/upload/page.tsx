import type { Metadata } from "next";
import Uploader from "@/components/upload/Uploader";
import "./upload.css";

export const metadata: Metadata = {
    title: "Upload",
    description: "Add movies and series to the library.",
};

export default function UploadPage() {
    return <Uploader colabUrl={process.env.COLAB_NOTEBOOK_URL || null} />;
}
