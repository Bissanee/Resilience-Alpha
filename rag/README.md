# Assistant documentaire — contrat du service

## Sources et isolation

Le service dans services/rag/server.py lit exclusivement les fichiers .md, .txt, .rst, .yaml et .yml montés en lecture seule sous /docs. Il n'accède ni à PostgreSQL, ni aux secrets, ni au socket Docker. Les documents sont découpés en passages avec recouvrement et indexés par BM25 via LangChain.

## API interne

- GET /health : état de l'index et disponibilité des composants LangChain.
- GET /documents : liste des sources indexées.
- GET /metrics : compteurs de requêtes et d'erreurs.
- POST /ask : corps JSON { "query": "question en français" }, longueur maximale 2 000 caractères. Retourne answer, mode, model et sources.
- POST /reindex : recharge les documents locaux.

Le port 5200 n'est pas publié sur l'hôte. Le dashboard relaie POST /api/rag/ask vers le service interne après validation de taille et de type de la question.

## Génération et repli

LangChain BM25 sélectionne les passages ; LangChain ChatOllama utilise le modèle configuré par OLLAMA_MODEL. Le prompt demande une réponse en français, fondée sur les sources fournies, et impose de signaler les informations absentes. Les réponses incluent les chemins des sources et des extraits.

Si Ollama est indisponible ou si le modèle n'est pas téléchargé, le service retourne les extraits retrouvés en mode retrieval_only. Ce mode est explicitement présenté à l'utilisateur et ne doit pas être confondu avec une réponse générée par LLM.

## Sécurité et limites

- Le contenu des documents est un contexte de recherche, pas une source d'autorité sur les secrets ou les actions système.
- Le service ne possède aucun outil d'exécution et ne peut pas déclencher une remédiation.
- La qualité des réponses dépend de la qualité et de l'actualité des documents présents dans docs/.
- Le tableau NIS2/DORA du dépôt est une mise en perspective pédagogique, pas une attestation de conformité.
