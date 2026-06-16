import logging
import os
import threading
import webbrowser
from threading import Timer

from flask import Flask

from src.web.routes import api
from services.corretora import iniciar_websockets, get_client

logger = logging.getLogger(__name__)

_JA_ABRIU = False


def _start_background_services():
    iniciar_websockets()
    c = get_client()
    if c:
        logger.info("Cliente Binance conectado")
    else:
        logger.info("API publica Binance disponivel")


def create_app(debug: bool = True, port: int = 5001, open_browser: bool = True) -> Flask:
    global _JA_ABRIU

    app = Flask(
        __name__,
        template_folder="../../templates",
        static_folder="../../static",
    )

    app.register_blueprint(api)

    threading.Thread(target=_start_background_services, daemon=True).start()

    if open_browser and not _JA_ABRIU and not os.environ.get("WERKZEUG_RUN_MAIN"):
        _JA_ABRIU = True
        Timer(1.5, lambda: webbrowser.open_new(f"http://127.0.0.1:{port}/")).start()

    return app
