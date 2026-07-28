export default function GlobalLoading() {
    return (
        <div className="fixed inset-0 min-h-screen bg-background flex items-center justify-center z-50">
            <div className="loader-stage">
                <div className="ring"></div>
                <div className="logo-wrap">
                    <img className="logo-img" src="/Personalflix.png" alt="Loading" />
                    <div className="shine"></div>
                </div>
                <div className="loader-label">LOADING</div>
            </div>
        </div>
    );
}
