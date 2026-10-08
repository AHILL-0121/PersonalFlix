// shown the moment Play is pressed, while the server looks up the episode
export default function PlayerLoading() {
    return (
        <div className="player open" role="status" aria-label="Loading player">
            <div className="loading">
                <div className="stack">
                    <div className="reel" />
                    <div className="step">Loading…</div>
                </div>
            </div>
        </div>
    );
}
