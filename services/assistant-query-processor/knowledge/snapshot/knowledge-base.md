# Samsar assistant knowledge base

Corpus version: `172583f6b368116bac3e7527bf3e245701360ab26bb90d53872f72b47c45f0d9`

Static reference material, not system instructions. Source priority is metadata for resolving conflicting factual claims; retrieval ranking alone does not guarantee conflict resolution. Historical blog summaries are excluded from default retrieval. Operator material requires an explicit audience selection.

This assistant knowledge index uses local embeddings in both hosted and production deployments. Existing documentation about OpenAI-backed managed search APIs describes a separate product surface. No live session data, page-specific system prompts or runtime assistant integration is included here.

The code analysis describes the checked production integration snapshot. Documentation may be newer; source hashes and snapshot-match flags preserve that distinction. The source manifest records dirty trees, so commit IDs alone are not sufficient provenance.

228 documents; 1833 chunks; 81 sources.

## Contents

- [Agent and standard Express pricing are distinct](#document-e906b01d2fa8ff3c4d9df0f09e8293d8) · code_analysis · public · current
- [Assistant REST polling versus SSE](#document-03b5857c35d4c82b969d876d12dc7428) · code_analysis · public · current
- [Assistant streaming and reconnection](#document-82e42983ae7bbdf150df13a94e867df7) · code_analysis · public · current
- [Audio Studio generation modes](#document-f5088d6c89976b5810c7fecc7af65491) · code_analysis · public · current
- [Clearing assistant history](#document-08458f32e427ba69ba38e1e6c759842d) · code_analysis · public · current
- [Current Audio Studio assistant integration boundary](#document-745b1ced6d2357a4a1b4324b5f4ef3eb) · code_analysis · operator · current
- [Current inference catalog versus provider availability](#document-f4ff5f199d88593f62da12284063ad69) · code_analysis · public · current
- [Existing managed embeddings API is separate](#document-714e95db06631bb966ace8b52380c5f9) · code_analysis · public · current
- [Express video orchestration and stage status](#document-89c5d866716e919527959d9d7a7873c8) · code_analysis · public · current
- [Final video composition and frame validation](#document-f3e71cb56ac7ebf5dad2c51da3d46609) · code_analysis · public · current
- [GPT Image stable application keys](#document-e90f26df24d998c04bd05ef5fc2076f6) · code_analysis · public · current
- [Image Studio assistant canvas context](#document-a5f3b12dcebb59b7894b70d34404639c) · code_analysis · public · current
- [Image Studio edit request and mask](#document-69af0208bc1f36cb0fc74f4ce9e1088b) · code_analysis · public · current
- [Image generation billing scopes](#document-28fe7ad44266ef3fbecacec1b1e9d161) · code_analysis · public · current
- [Joining audio items in Audio Studio](#document-c8afcf9ba1442b56ed08d573b75c012b) · code_analysis · public · current
- [Kling 4 model keys, durations and Studio rate](#document-dcce68297334d34debf12f33c9fd5b53) · code_analysis · public · current
- [Lip-sync fallback is distinct from base-video failure](#document-6a481504ea3b1303a074c7d1cd8058f2) · code_analysis · public · current
- [Scene timing uses the selected frame rate](#document-6af3ba3fc3314f291ac85207a01b2c17) · code_analysis · public · current
- [Shared assistant prompt and retrieval boundary](#document-13de773709508ac4244384755f1e068a) · code_analysis · operator · current
- [Speech bound to a scene versus independent Studio speech](#document-8c78f7519aa1cf2587c706f188bde64d) · code_analysis · public · current
- [Video Studio assistant frame attachment](#document-8bbec1562c95316f0ed428bdda13b1f0) · code_analysis · public · current
- [Video generation tariff snapshots](#document-3a7c5f498a7f4301b88e17a884435da0) · code_analysis · operator · current
- [Video retranslation order and inference settings](#document-e40e8301de93620f817a2027d5d2d3a2) · code_analysis · public · current
- [Vidgenie assistant context in the current client](#document-2fa8fc82012cf775446658fbb2ba9690) · code_analysis · operator · current
- [Assistant API](#document-1caa7010a87afb89868037ded4f8858b) · docs · public · current
- [Build generative media workflows with one API](#document-7cb0c452e757f7b5b8aa1bf0f51b79ac) · docs · public · current
- [Chat API](#document-a8ea66ae7d93b398a22b16b968367532) · docs · public · current
- [Create a branching narrative](#document-cc4a47c3e67cb0f70a590703b3ea9762) · docs · public · current
- [Create a single narrative](#document-61f2fe8c8811304047f9df46f30009a5) · docs · public · current
- [Credits API](#document-75ccdfc65a9eafd59ab27c7a5e3ba0f8) · docs · public · current
- [External Requests API](#document-b5ac2b2c012f6ab0495daa4a05d38b3b) · docs · public · current
- [External Users API](#document-3a636b8a5cd6477b15ade86d88f4fb0a) · docs · public · current
- [Fonts](#document-0097c8810e57e6da13cab6ad4c1a77c3) · docs · public · current
- [Hosted Samsar.js & deployment adapters](#document-577ae37eeeb0614a90c86838def23a7c) · docs · public · current
- [Image API](#document-7e8068aa200a028429c0c79326e7112d) · docs · public · current
- [Login Tokens](#document-c97af5942b7fd9f32ce714fa483679ad) · docs · public · current
- [Narrative API](#document-4da411b123f681c29a8467460af6dd70) · docs · public · current
- [One platform. Every model, in context.](#document-b07304693fa59961c88fbb6d04db04d4) · docs · public · current
- [Publications API](#document-341374514279d81a89be75dd68fe80a1) · docs · public · current
- [Render a narrative as video](#document-0e279fdfc97ca1d26e57ba82eb3cce8b) · docs · public · current
- [V2 API](#document-a6fd7f8d3bcb83a74ed791a7ca6d290b) · docs · public · current
- [Video API](#document-cf49cb6fa9921dff55bfda3add77d8d0) · docs · public · current
- [Blog integration: BLOG_SETUP.md](#document-c88f01d6e694d39ce19e291ceebf4c64) · project_docs · operator · current
- [Blog integration: README.md](#document-e84cbb96df5caed6e2b54fb67f642719) · project_docs · operator · current
- [Architecture](#document-c5e4ebf15f0b5858b2a809c32c9b030e) · monorepo_docs · operator · current
- [Architecture > Assistant Billing and Recovery](#document-01533664e2f4e317e646f0495ca5652d) · monorepo_docs · operator · current
- [Architecture > Compose Profiles](#document-de17fa9be10d8c110041c0efe77915c9) · monorepo_docs · operator · current
- [Architecture > Deployment Modes](#document-8bcd0ba6a9f7da2d0b130eb6fab91209) · monorepo_docs · operator · current
- [Architecture > Observability](#document-b97ca669f7dc6cda80de4d12902e3977) · monorepo_docs · operator · current
- [Architecture > Provider Calls](#document-a108eb3d6b028ea0a4c9252e48193aa0) · monorepo_docs · operator · current
- [Architecture > Request Flow](#document-d3d84aa388e270c5b419f1f5d0d358cc) · monorepo_docs · operator · current
- [Architecture > Runtime Config](#document-774a5dacd9177b1e528e0424ed23f446) · monorepo_docs · operator · current
- [Architecture > Runtime Shape](#document-2f382e0cb1e9bf4e0c5192ef5508cc35) · monorepo_docs · operator · current
- [Architecture > Storage and Media](#document-03e4f70817fea0944eea695e2e5b5dad) · monorepo_docs · operator · current
- [Assistant Billing and Retries](#document-87d89ac03914627e0005c3071b49e794) · monorepo_docs · public · current
- [Assistant Billing and Retries > Credit Balances](#document-800f03a831ca2fd6243c05f0d56012df) · monorepo_docs · public · current
- [Assistant Billing and Retries > Final Token Prices](#document-1f2def242e040688f98039c3dde72661) · monorepo_docs · public · current
- [Assistant Billing and Retries > Paid Tools and Pending Requests](#document-083d9b8cf53128bd3e078c582bc738f5) · monorepo_docs · public · current
- [Assistant Billing and Retries > Regression Checks](#document-9bd5ecd37a9ad16a7f3e4b62a4bbeeca) · monorepo_docs · operator · current
- [Assistant Billing and Retries > Retries and Settlement](#document-ecd21e1e2f57ad9051ec544ca4f6d92a) · monorepo_docs · public · current
- [Assistant Billing and Retries > Scope](#document-b31cd4bb1de11536f6353e5cfbfa21eb) · monorepo_docs · public · current
- [Assistant Billing and Retries > Streaming and Conversation Reset](#document-0587c8262a9ed8f8d28976c9e64c0d11) · monorepo_docs · public · current
- [Audio and performance](#document-7a2c6c4789295333a4571055508ec70f) · monorepo_docs · public · current
- [Audio and performance > Billing and delivery](#document-992a76e73867dcef0d4b8a5cce83df58) · monorepo_docs · public · current
- [Audio and performance > Choose the operation](#document-ec3fb277228fe0b7a53675edb25674cf) · monorepo_docs · public · current
- [Audio and performance > Expand to standalone adapters](#document-57999fa3eb1f13df811b5c5bbb0470ab) · monorepo_docs · public · current
- [Audio and performance > Generate with Samsar.js](#document-1af9cecd5f8f444e2b551c83cf2e5474) · monorepo_docs · public · current
- [Audio and performance > Use audio inside a video workflow](#document-90168c114d1bbf04c44b34f4e9dac141) · monorepo_docs · public · current
- [Features](#document-8f33aaa80aa47c21c3c77a1a722a5f43) · monorepo_docs · public · current
- [Features > API](#document-ceff7897628c002111fc001956197a10) · monorepo_docs · public · current
- [Features > API > Assistant billing](#document-237bf73b5aae4f6f133621c82750f256) · monorepo_docs · public · current
- [Features > API > Image billing](#document-8fd78cde3088bcb3449bde5884d2f478) · monorepo_docs · public · current
- [Features > API > Video model billing](#document-e2e55fdb3e5825f9afde5d697c2d5729) · monorepo_docs · public · current
- [Features > Adapters, models, and storage](#document-d69e60895e95e1988e2586ed242b217e) · monorepo_docs · public · current
- [Features > Adapters, models, and storage > Minimal adapter setup](#document-e77e06757d1a1a0727f64eaab9f142ea) · monorepo_docs · public · current
- [Features > Adapters, models, and storage > Model adapters](#document-808fd40ab42c02da6a6330327d3c0803) · monorepo_docs · public · current
- [Features > Adapters, models, and storage > Storage adapters](#document-87316fab814455bb7f916a2f3b8a5384) · monorepo_docs · public · current
- [Features > Adapters, models, and storage > Supported models by capability](#document-4cf4c265187e0df7ecb7663032394126) · monorepo_docs · public · current
- [Features > Deployment and operations](#document-7fa37fb2bb77eeb339739d59d2525110) · monorepo_docs · operator · current
- [Features > Deployment and operations > External access](#document-dbbec168912608ad37a1e412943cb53b) · monorepo_docs · operator · current
- [Features > Development](#document-a1f146535eb92d85b261fe08936d3f90) · monorepo_docs · public · current
- [Features > Documentation](#document-ddd21a4578cb896df71433e262eeb9d7) · monorepo_docs · public · current
- [Features > Platform > Repository layout](#document-4e1eead4f141cbbe18dea97aa2a4e6d0) · monorepo_docs · operator · current
- [Features > Quick start](#document-abc08545969d20ef5b5b4d676a3d0166) · monorepo_docs · operator · current
- [Features > Quick start > 1. Prepare](#document-e74583bb9f10adc586c2c29118422f33) · monorepo_docs · operator · current
- [Features > Quick start > 2. Launch the setup wizard](#document-2b1a14e6a3195a3b67fe2de329373e9e) · monorepo_docs · operator · current
- [Features > Quick start > 3. Open your local services](#document-6481e358b995e871ad96268c85432916) · monorepo_docs · operator · current
- [Features > Troubleshooting](#document-75c760c39a628511645dec29f825be26) · monorepo_docs · public · current
- [Features > Visual workflows](#document-2bdabaae194b0f4cebd14351971d0b8c) · monorepo_docs · public · current
- [Image Billing and Retries](#document-698754e3d8e6192c3efcebe88dee3c41) · monorepo_docs · public · current
- [Image Billing and Retries > Completion receipts](#document-b6a36cd297200cfe322e8959057bd229) · monorepo_docs · public · current
- [Image Billing and Retries > Deployment Configuration](#document-cd6df3bdf66964b19ba04d3b53af3361) · monorepo_docs · operator · current
- [Image Billing and Retries > Final image token prices](#document-21fd28711ad757ffd54b35267db68e22) · monorepo_docs · public · current
- [Image Billing and Retries > Final output image prices](#document-46b66adf80d2fb570825d7077a7f11a4) · monorepo_docs · public · current
- [Image Billing and Retries > Verification](#document-93a217c4272f7f0a7b1bbbd2fd817ba9) · monorepo_docs · operator · current
- [Image Edit](#document-6dd20f0ffaac2db6c4d02c2f08555db1) · monorepo_docs · public · current
- [Image Edit > Branding Removal](#document-3d99747f95afd4de51c6ee8a768e79bf) · monorepo_docs · public · current
- [Image Edit > Docker Services](#document-59fbf1e6315ef77a572210d28390bb50) · monorepo_docs · operator · current
- [Image Edit > Enhance](#document-d9d8ffab0fd5e696cd15e5f343b8de92) · monorepo_docs · public · current
- [Image Edit > Final prices and completion billing](#document-fb87aec02cac398b608c991b42f7837f) · monorepo_docs · public · current
- [Image Edit > Hosted Samsar.js](#document-2adff5c17747d8fb376d916dcd264d92) · monorepo_docs · public · current
- [Image Edit > Image Set Expansion](#document-941e907218e77553c62915e270068f4e) · monorepo_docs · public · current
- [Image Edit > Main Endpoints](#document-0317963c7efde64e7d9574fd432a781c) · monorepo_docs · public · current
- [Image Edit > Provider Availability](#document-145238ace6089e62886f4e4b77be74dc) · monorepo_docs · public · current
- [Image Edit > Status and Listing](#document-8ca4a41384f749f4c195d38c28f02722) · monorepo_docs · public · current
- [Image Edit > Text to Image](#document-0e7324b647300aad3b48635b214b4966) · monorepo_docs · public · current
- [Image List to Video](#document-5ce467b0e2ac811822247ec35858bf7d) · monorepo_docs · public · current
- [Image List to Video > Ad Video and CTA Options](#document-46b808da063adc4ac82eea2f04f5f548) · monorepo_docs · public · current
- [Image List to Video > Common Optional Fields](#document-99d080a7a38b6c57be31c8ef791d9477) · monorepo_docs · public · current
- [Image List to Video > Docker Pipeline](#document-5e7d1a2d7907ea0c886af14b2669b6e6) · monorepo_docs · operator · current
- [Image List to Video > Endpoints](#document-8560888daf18bae9493a28a65797d8ce) · monorepo_docs · public · current
- [Image List to Video > Hosted Samsar.js](#document-accfc5380eb9c56d8356148a2bb11b3c) · monorepo_docs · public · current
- [Image List to Video > Required Fields](#document-1e48ec79d4f75bef735b6a2bf72096dc) · monorepo_docs · public · current
- [Image List to Video > Supported Models](#document-a411ed4229ff19ab8d7dfabaa1ecf0eb) · monorepo_docs · public · current
- [Model matrix](#document-fbafb2746c7e64d07d698b4bd50dfa0f) · monorepo_docs · public · current
- [Model matrix > Catalog maintenance](#document-a95f1d36338e1a1c26636cf1988b760a) · monorepo_docs · operator · current
- [Model matrix > Check your deployment](#document-6dd7b0175c0b1aa352d3ba2143817c18) · monorepo_docs · operator · current
- [Model matrix > Choose a modality](#document-eeda66d08f1523b0569623e78694e857) · monorepo_docs · public · current
- [Model matrix > Embeddings & search](#document-f769245a4861be0f093bcdd19f7c7fa6) · monorepo_docs · public · current
- [Model matrix > Image editing](#document-221b6e35f1f3e75fc742a70b9c74f9bb) · monorepo_docs · public · current
- [Model matrix > Image generation](#document-c510e06a841c8cc5ac529b84dabf2922) · monorepo_docs · public · current
- [Model matrix > Inference & vision](#document-eac54ba8ed85a280cc7c4fc5f26d57ab) · monorepo_docs · public · current
- [Model matrix > Lip sync](#document-41025ef4b53fca3b8b5ee1ca8dac72e1) · monorepo_docs · public · current
- [Model matrix > Music](#document-1ea026cbb1c4f639cf705147af4c0c3a) · monorepo_docs · public · current
- [Model matrix > Sound effects](#document-69ffe1f4aabbe59daeda904ec0d6a37b) · monorepo_docs · public · current
- [Model matrix > Speech](#document-4fb93edecdd9f651cf34a06b12b224e5) · monorepo_docs · public · current
- [Model matrix > Transcription](#document-62bee920ce5dfbdba1f9cf7c90ddf70e) · monorepo_docs · public · current
- [Model matrix > Video generation](#document-2128ff7b195d445c2f81044a13362383) · monorepo_docs · public · current
- [Providers and Models](#document-6565d72ece85ff1ce0386ac3721ff1ed) · monorepo_docs · public · current
- [Providers and Models > AI-Video Pricing Across Adapters](#document-414af68b9c959e3e0ea83288a91764d2) · monorepo_docs · public · current
- [Providers and Models > Assistant Pricing Across Adapters](#document-500a3a3d91e49b730513098f61a99388) · monorepo_docs · public · current
- [Providers and Models > Fallback Rules](#document-718424f76ca32a9e179ad51af9a78342) · monorepo_docs · public · current
- [Providers and Models > Generated Availability](#document-f779bd5e19c4e029775c3cec6ebaab75) · monorepo_docs · public · current
- [Providers and Models > Image Pricing Across Adapters](#document-d74e9561dfa0bd38f39281685b250bc3) · monorepo_docs · public · current
- [Providers and Models > Kimi K3 Adapter](#document-da6dcf1e6f05edb23b300eee986740bd) · monorepo_docs · public · current
- [Providers and Models > Local Verification](#document-087a15dca50718f04f9db011a6978b7d) · monorepo_docs · operator · current
- [Providers and Models > Model Groups Used by Video APIs](#document-bfdc3a958ba16b64838a231f0ac85d5c) · monorepo_docs · public · current
- [Providers and Models > OpenRouter Qwen Adapter](#document-aaef9c39123be7918e8f6b5f85953b6b) · monorepo_docs · public · current
- [Providers and Models > Provider Matrix](#document-dee11b061c131e244b0121a5ccff098a) · monorepo_docs · public · current
- [Providers and Models > Standalone Model Adapter Preferences](#document-37549a6e439d9a0455e41a6130a358d5) · monorepo_docs · public · current
- [README](#document-ab99806403ef54d80c3e2e8605746b28) · monorepo_docs · public · current
- [Recommendations](#document-9d8b30573c77cd79ffc34d51605aa0a7) · monorepo_docs · public · current
- [Recommendations > Docker Services](#document-a4e548839fd6eeca038b8ba4594689c2) · monorepo_docs · operator · current
- [Recommendations > Endpoints](#document-296a378eea698efbc9cf5acbc376a994) · monorepo_docs · public · current
- [Recommendations > Hosted Samsar.js](#document-dd8edacd81bc7015589554f7be40db58) · monorepo_docs · public · current
- [Recommendations > How It Differs From Search](#document-6e2653a790b6778aa3c66512b58ae19c) · monorepo_docs · public · current
- [Recommendations > Optional Input](#document-943832071decbe61187b9393c8ba3f88) · monorepo_docs · public · current
- [Recommendations > Provider Availability](#document-87244bbedd8171404a6638c8880b5d90) · monorepo_docs · public · current
- [Recommendations > Required Input](#document-6de86d940560f752fb82dd94cc5cb19a) · monorepo_docs · public · current
- [Recommendations > Typical Flow](#document-f595ce2eb936ecbd64a7f6ca93458780) · monorepo_docs · public · current
- [Runtime Modes > Docker Compose](#document-18b95c84ac9185345aeec106a51945c4) · monorepo_docs · operator · current
- [Runtime Modes > Kubernetes](#document-c8190144992eba4a2276a0fb9db61bb4) · monorepo_docs · operator · current
- [Runtime Modes > Local](#document-bc32a94be5541a425dfddc2f1468fb34) · monorepo_docs · operator · current
- [Search](#document-f7007c911bb80c2536a21402f9f1f041) · monorepo_docs · public · current
- [Search > Create an Index](#document-2d57cad881162fb87773a847690bafff) · monorepo_docs · public · current
- [Search > Docker Services](#document-6e24e41861988768d682687c8a171c1c) · monorepo_docs · operator · current
- [Search > Hosted Samsar.js](#document-0d2fad7de5e98640793a3b5626c24e19) · monorepo_docs · public · current
- [Search > Manage Templates](#document-35e546e3fd0164acb990676c686de279) · monorepo_docs · public · current
- [Search > Operational Notes](#document-bf9e7d806bfd815d80af98faa30934f0) · monorepo_docs · public · current
- [Search > Query Search](#document-437379f2f2d15697d732078ce00604f8) · monorepo_docs · public · current
- [Setup Wizard](#document-6d6952efb70e4c45dea27f20852bdfac) · monorepo_docs · operator · current
- [Setup Wizard > Data and Mail Modes](#document-60e15abb43b8730ce94f350710570dc7) · monorepo_docs · operator · current
- [Setup Wizard > Domain and Reverse Proxy](#document-b9869278af6959b9ff0f69150b5c4ddc) · monorepo_docs · operator · current
- [Setup Wizard > Existing installations and updates](#document-2fa7d1ffe72d5ee61597f0854aadf3f0) · monorepo_docs · operator · current
- [Setup Wizard > Files Written](#document-12bcb901eb8c7f6541c60360b5b1c7f2) · monorepo_docs · operator · current
- [Setup Wizard > Launch](#document-dd877c0acd6148f3abd790ec890f3276) · monorepo_docs · operator · current
- [Setup Wizard > Local access](#document-ccf7b9e19971960471e9828f91f2101b) · monorepo_docs · operator · current
- [Setup Wizard > Provider Logic](#document-9f29e1a55e77d968add579a9ec18595a) · monorepo_docs · operator · current
- [Setup Wizard > Services Catalog](#document-2d62ee2b97f91f56463ab9c0194a6592) · monorepo_docs · operator · current
- [Setup Wizard > Setup Run Lifecycle](#document-af20001e5de7d25519524595446fb50b) · monorepo_docs · operator · current
- [Setup Wizard > When to Use Manual Config Instead](#document-01b4f689637eff7601c640a51d145958) · monorepo_docs · operator · current
- [Setup Wizard > Wizard Steps](#document-8f4f46bfe3cd84b93b023f91de3b34ac) · monorepo_docs · operator · current
- [Text Enhance](#document-49481936c18d6a1746535a7d15f3d2ec) · monorepo_docs · public · current
- [Text Enhance > Auth](#document-5875209c17707f741e8c930e33d9e66f) · monorepo_docs · public · current
- [Text Enhance > Docker Services](#document-07563ac4c718452b2c11a6895606ea99) · monorepo_docs · operator · current
- [Text Enhance > Endpoint](#document-505f0b363efe5b9e1045b5914c8e14ad) · monorepo_docs · public · current
- [Text Enhance > Hosted Samsar.js](#document-2d38e7f5561d765e5c755a0da0ab50a7) · monorepo_docs · public · current
- [Text Enhance > Request Body](#document-bc8849f4f6b3f72dbd47b79c51d47a0d) · monorepo_docs · public · current
- [Text Enhance > Runtime Behavior](#document-4c14206e4d54ac4f875b3b763cdac4d7) · monorepo_docs · operator · current
- [Text to Video](#document-c2705a377e65bbc93ca3de7d9d5f3ac7) · monorepo_docs · public · current
- [Text to Video > Docker Pipeline](#document-dd0330850f1617bdcd4c7961eb99a250) · monorepo_docs · operator · current
- [Text to Video > Endpoints](#document-d4effa462189ff4d20745ba590d76b8e) · monorepo_docs · public · current
- [Text to Video > Hosted Samsar.js](#document-29e16cf711781edc1ee18df3c10682cb) · monorepo_docs · public · current
- [Text to Video > Optional Fields](#document-b4bc006c7d84d634abbb70379aee9884) · monorepo_docs · public · current
- [Text to Video > Required Fields](#document-7722a449d8fef388faa03a256bc5928f) · monorepo_docs · public · current
- [Text to Video > Status](#document-8c628052f4393d4a6c9b107df32da2d0) · monorepo_docs · public · current
- [Text to Video > Supported Model Keys](#document-8724280fc9bca40f9a380a100dc7f894) · monorepo_docs · public · current
- [Video model billing and retries](#document-41d11b3bf0e9611a96244314d93ff7a3) · monorepo_docs · public · current
- [Video model billing and retries > Endpoint scope](#document-31d4ff900b7e7dd30df2d00c0a5635f5) · monorepo_docs · public · current
- [Video model billing and retries > Fal-backed lip-sync pricing](#document-54d004a2b4224be159317318bc607b7d) · monorepo_docs · public · current
- [Video model billing and retries > Fal-backed video sound-effect pricing](#document-5dd21ef975711d6b491bb7f5eac94ee9) · monorepo_docs · public · current
- [Video model billing and retries > Final AI-video output prices](#document-942c7b5214d7828ef514efe10f819b0e) · monorepo_docs · public · current
- [Video model billing and retries > Provider configuration](#document-355c17d268c6f2ac85f6e48d876dafaf) · monorepo_docs · public · current
- [Video model billing and retries > Regression checks](#document-18dd500a1eaff21f334a3d5e0e96964d) · monorepo_docs · operator · current
- [Video model billing and retries > Retry contract](#document-defb69f662e4a2c288144a2a01ab012c) · monorepo_docs · public · current
- [Add Lip-Sync to Generative Scenes in SamsarOne Studio — creative workflow guidance](#document-be5c0e9aae1314819c22eb167d3da954) · creative_guidance · public · editorial
- [Bring myths to life with Samsar — creative workflow guidance](#document-2aff6af1b732d4160990748a067b9ff2) · creative_guidance · public · editorial
- [Comparing the Inference Engines — creative workflow guidance](#document-2e76def8afc7572d40bd9769d57290a4) · creative_guidance · public · editorial
- [Consistency in generative-video projects — creative workflow guidance](#document-4e2fac6539f4efff05146db16616ee93) · creative_guidance · public · editorial
- [Ed-Tech content with Samsar T2V agent — creative workflow guidance](#document-ed2b42ebdaa9e53435fc25bc87dedeb8) · creative_guidance · public · editorial
- [GPT Image 2 is here- We tried giving it some of the hardest battles — creative workflow guidance](#document-cff7311529bcb5ed6779e146930d3859) · creative_guidance · public · editorial
- [Generative Documentaries from Extinct Worlds — creative workflow guidance](#document-872347db1a5ff2f3977d3e4165a445ba) · creative_guidance · public · editorial
- [Increased quality, faster renders and more model options with the Samsar the One Text/Image-List to Video Agent — creative workflow guidance](#document-4f4fd98a187d9efdd451176d6a3b3ce9) · creative_guidance · public · editorial
- [On-Demand Dynamic Ed-Tech with the Samsar Framework — creative workflow guidance](#document-9a7fdbd66f84f222228867d901677c4e) · creative_guidance · public · editorial
- [Text-to-Movie in one-shot with generative agentic pipelines — creative workflow guidance](#document-63a6993bf0f5080f6cb6fe923ab9e338) · creative_guidance · public · editorial
- [The AI Food Video Challenge — creative workflow guidance](#document-6e02442426676fb2d7130e00132e98dd) · creative_guidance · public · editorial
- [The Agent is now in Public Beta — creative workflow guidance](#document-4a41089b19ad062841e7b2e225089eb9) · creative_guidance · public · editorial
- [What's new with Samsar Omni agent — creative workflow guidance](#document-f866b58029b6cae91e9c0d98b65b070a) · creative_guidance · public · editorial
- [Add Lip-Sync to Generative Scenes in SamsarOne Studio](#document-d42cc95decd57a44cc83015fc201e0ae) · blog_history · public · historical
- [BackBlaze B2 cloud and GenBlaze adapter are now configurable in Samsar.](#document-330e60c69b3ffb4c24517c40d2d1d381) · blog_history · public · historical
- [Bring myths to life with Samsar](#document-f591f9ea2b1f38625a1686b7a8adefaf) · blog_history · public · historical
- [Comparing the Inference Engines](#document-9bbffac08b3dbf954551f26f8c58b7c7) · blog_history · public · historical
- [Consistency in generative-video projects](#document-1876f5cfd9f402e80879b92551e048ee) · blog_history · public · historical
- [Deploy Sandboxed Generative API servers with Model Composable Payload](#document-8ed1c931500570bf976d29b7586cded8) · blog_history · public · historical
- [Ed-Tech content with Samsar T2V agent](#document-9f8550542a90cca8b2b18d1647b3402c) · blog_history · public · historical
- [GPT Image 2 is here- We tried giving it some of the hardest battles](#document-1b468b4b6a48110a29a5efe0dbf61640) · blog_history · public · historical
- [Generative Documentaries from Extinct Worlds](#document-2a61036cfc1384be8390176c37771b2d) · blog_history · public · historical
- [Increased quality, faster renders and more model options with the Samsar the One Text/Image-List to Video Agent](#document-45d7a2e93eacb6069e4b0b572c5eaa78) · blog_history · public · historical
- [Managed APIs for deploying SoTA Search and Recommendation systems with minimal configuration requirements](#document-bbb3e77974faa1de27771eaa644230c2) · blog_history · public · historical
- [On-Demand Dynamic Ed-Tech with the Samsar Framework](#document-39ea5fbc193419565fd744a0ffd7d70f) · blog_history · public · historical
- [Our Full-Stack Video Creation Agent API is Now Live](#document-0d917725d589687ccac3434d4e480490) · blog_history · public · historical
- [QWEN 3.7 Inference and Native Alibaba Cloud integration is here](#document-962069d130c8bf286d45b9dc9c8560c6) · blog_history · public · historical
- [SeeDance 2.5 is now configurable in the prompt-to-visualize anything framework](#document-560eabf510d152007dcdb388cf53c60a) · blog_history · public · historical
- [Text-to-Movie in one-shot with generative agentic pipelines](#document-74f11c89983f5595a3da1bdba0e26883) · blog_history · public · historical
- [The AI Food Video Challenge](#document-c4af576603b708ec021812daa53c2f14) · blog_history · public · historical
- [The Agent is now in Public Beta](#document-c10f63d6b0724d6ff1cf095ed74c878f) · blog_history · public · historical
- [The Samsar project is now generally available, open-source under MIT license](#document-7cb053105676a3721c1698af76d5123f) · blog_history · public · historical
- [What's new with Samsar Omni agent](#document-32d7d7a7481424a988b47fd89c26eb3a) · blog_history · public · historical

<a id="document-e906b01d2fa8ff3c4d9df0f09e8293d8"></a>
## Agent and standard Express pricing are distinct

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/consts/pricing/ExpressVideoPricingDistribution.js; production:services/processor/src/models/api/StepVideoAPI.js

Agent/Vidgenie uses fixed workflow pricing, distinct from individual Studio or external generation charges. In the reviewed rate table, Seedance 2.5 costs 60 credits per second for Agent/Vidgenie and 50 credits per second for the standard Express rate class. Kling 4 agent video remains 36 credits per second. Optional additions and individual operations need their own pricing scope; do not quote a workflow rate as a standalone model generation rate.


<a id="document-03b5857c35d4c82b969d876d12dc7428"></a>
## Assistant REST polling versus SSE

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/models/api/ExternalChatAPI.js

The external chat API retains ordinary JSON completion and asynchronous polling options. stream: true selects SSE. Combining streaming with explicit asynchronous polling is rejected; choose one transport for a request. Request correlation and idempotency are part of the processor contract and remain separate from knowledge retrieval.


<a id="document-82e42983ae7bbdf150df13a94e867df7"></a>
## Assistant streaming and reconnection

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/models/api/ExternalChatStreaming.js

External assistant streaming uses server-sent events named request, snapshot, completed and error. A snapshot contains the accumulated response text, so consumers should replace the displayed text rather than append the entire snapshot repeatedly. Generation and settlement can continue after the connection closes. Reconnecting with the same request key retrieves the existing request instead of intentionally starting a new billable generation.


<a id="document-f5088d6c89976b5810c7fecc7af65491"></a>
## Audio Studio generation modes

Source class: code_analysis; audience: public; freshness: current.

Sources: production:apps/studio/src/components/audio/AudioStudioHome.jsx

Audio Studio supports music, speech and sound-effect generation. Music requests include the prompt, model, duration and instrumental choice. Speech uses the entered script and selected voice/provider. Sound-effect requests include prompt, model and duration. The client submits /audio/studio/generate and tracks the returned request ID until completion, refreshing the corresponding library.


<a id="document-08458f32e427ba69ba38e1e6c759842d"></a>
## Clearing assistant history

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/routes/assistants.js; production:services/processor/src/models/Assistant.js

The assistant reset route is /assistants/reset_session_messages. Resetting advances the session version and clears prior assistant conversation state, preventing replies from older versions from reappearing in the current session. Billing receipts retain accounting information while old conversational content is removed. Clearing chat history does not imply refunding previously completed inference.


<a id="document-745b1ced6d2357a4a1b4324b5f4ef3eb"></a>
## Current Audio Studio assistant integration boundary

Source class: code_analysis; audience: operator; freshness: current.

Sources: production:apps/studio/src/components/audio/AudioStudioHome.jsx

The reviewed AudioStudioHome implements generation, library browsing and audio joining. It does not import or mount AssistantHome and does not submit assistant queries. An Audio Studio assistant is therefore a future integration task; this corpus must not imply that the same popup is already wired into all four editors.


<a id="document-f4ff5f199d88593f62da12284063ad69"></a>
## Current inference catalog versus provider availability

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/consts/InferenceModels.js; production:services/processor/src/consts/InferenceModels.js

The reviewed inference catalog includes GPT 6 Astra, GPT 6.1 Sol, Claude Opus 5.5, Claude Fable 5.1, Gemini 4 Argon, Qwen 3.8 and Kimi K3. GPT and Claude reasoning options include high and xhigh. A model being present in the application catalog is not evidence that a particular installation has credentials or provider access for it; availability must come from the runtime configuration.


<a id="document-714e95db06631bb966ace8b52380c5f9"></a>
## Existing managed embeddings API is separate

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/models/embeddings/EmbeddingService.js

The processor's managed EmbeddingService currently uses text-embedding-3-large and contains search, similarity and reranking behavior for customer data. That existing paid API is separate from this static assistant corpus. Its model, storage and charges must not be reused as an assumed requirement for the assistant knowledge index, whose embedding and query design is local-only.


<a id="document-89c5d866716e919527959d9d7a7873c8"></a>
## Express video orchestration and stage status

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/express-video-listener/src/ExpressListener.js

The Express listener coordinates persisted image, audio, AI video, lip-sync, sound-effect, frame and final-video stages. A preview or a completed scene does not mean the final video is complete. Troubleshooting should identify the session stage and its recorded status rather than infer completion from a single asset. Static documentation contains no live session status.


<a id="document-f3e71cb56ac7ebf5dad2c51da3d46609"></a>
## Final video composition and frame validation

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/video-generator/src/GenerationProcessor.js; production:services/video-generator/src/GenerationProcessor.js

The final video generator composes the session's visual frames and selected audio using the session frame rate or its configured fallback. It validates the expected frame sequence and checks the rendered frame count. Scene previews and intermediate clips are separate from the completed final composition. After editing visual or audio layers, the final rendered video must be regenerated to include those changes.


<a id="document-e90f26df24d998c04bd05ef5fc2076f6"></a>
## GPT Image stable application keys

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/consts/ModelTypes.js

The public image catalog retains the stable application key GPTIMAGE2.5 while displaying the newer GPT Image 2.6 model label. Labels and request keys serve different purposes. Use the documented supported key for API requests; do not invent a new key solely from a newer display label.


<a id="document-a5f3b12dcebb59b7894b70d34404639c"></a>
## Image Studio assistant canvas context

Source class: code_analysis; audience: public; freshness: current.

Sources: production:apps/studio/src/components/image/ImageStudioHome.jsx

Image Studio can capture the current canvas as a PNG with a maximum dimension of 1536 pixels and attach it as frameImage to an assistant request. Canvas images are transient request context and must not become part of the shared documentation corpus.


<a id="document-69af0208bc1f36cb0fc74f4ce9e1088b"></a>
## Image Studio edit request and mask

Source class: code_analysis; audience: public; freshness: current.

Sources: production:apps/studio/src/components/image/ImageStudioHome.jsx

The reviewed Image Studio edit handler exports the base canvas and submits a prompt, session and layer IDs, aspect ratio and edit parameters to /image_sessions/request_edit_image. It currently sends model NANOBANANA2EDIT. If the selected edit mode is inpaint, it also exports maskImage. Multiple visible image inputs are deduplicated and supplied as image_urls. These are the observed handler behaviors, not a promise that every backend model accepts every edit field.


<a id="document-28fe7ad44266ef3fbecacec1b1e9d161"></a>
## Image generation billing scopes

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/generator/src/billing/ImagePricing.js

Image generation distinguishes standalone, adapter-priced, pipeline and legacy billing modes. The image pricing helper applies the current 1.2 pricing multiplier to validated adapter usage or tariff data. Pipeline charges and already-paid legacy jobs have distinct handling, so an individual image rate must not be added again to a fixed workflow price without checking the operation's billing mode.


<a id="document-c8afcf9ba1442b56ed08d573b75c012b"></a>
## Joining audio items in Audio Studio

Source class: code_analysis; audience: public; freshness: current.

Sources: production:apps/studio/src/components/audio/AudioStudioHome.jsx; production:services/processor/src/models/audio/AudioStudio.js

Audio Studio joins between 2 and 25 selected audio items. The user can reorder the selected items before submitting, choose the audio library type, add a title and enable fadeAudioAtEnds. The request goes to /audio/join, and status is read from /audio/join/status using the returned request ID. The client preserves the pending request ID so it can resume status checks after a reload. Joining is an asynchronous operation, not an instant timeline edit.


<a id="document-dcce68297334d34debf12f33c9fd5b53"></a>
## Kling 4 model keys, durations and Studio rate

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/utils/KlingModel.js

The current public Kling keys are KLINGIMGTOVID4 and KLINGTXTTOVID4. Allowed durations are 5, 10, 15, 20, 25 or 30 seconds, at the configured 720p resolution. The Studio rate constant is 18.84 credits per second. Legacy Kling 3 Pro and Turbo request aliases normalize to the v4 keys. This is separate from the fixed Agent/Vidgenie workflow rate.


<a id="document-6a481504ea3b1303a074c7d1cd8058f2"></a>
## Lip-sync fallback is distinct from base-video failure

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/express-video-listener/src/ExpressListener.js; production:services/express-video-listener/src/ExpressListener.js

The reviewed Express listener assesses lip-sync completion and has a fallback path for failed or missing lip-sync results when usable base video exists. It can continue with lip-sync skipped, recording that state. Missing base video is handled separately and can fail the stage. Advice to retry an entire generation is inappropriate without first checking which assets and stage results already exist.


<a id="document-6af3ba3fc3314f291ac85207a01b2c17"></a>
## Scene timing uses the selected frame rate

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/frames-processor/src/utils/FrameClock.js; production:services/video-generator/src/utils/FrameClock.js

Frame-clock helpers convert scene times into integer frame boundaries using the supplied frame rate. They quantize absolute start and end times rather than accumulating rounded scene durations. The helpers default to 24 fps when no rate is supplied; an assistant must not assume that every project is universally 30 fps. Timing advice should use the session's actual frame rate.


<a id="document-13de773709508ac4244384755f1e068a"></a>
## Shared assistant prompt and retrieval boundary

Source class: code_analysis; audience: operator; freshness: current.

Sources: production:services/assistant-query-processor/src/AssistantQueryListener.js; production:services/assistant-query-processor/src/SystemPrompt.js

The current assistant query processor builds its message list from getSystemPrompt, history and request content. SystemPrompt.js supplies a shared creative assistant prompt, with a user custom prompt override when provided. There is no static knowledge retrieval step in this reviewed message assembly. The knowledge corpus and local index are preparation for a later processor-side or separate retrieval layer; they do not introduce page-specific prompts or change the listener.


<a id="document-8c78f7519aa1cf2587c706f188bde64d"></a>
## Speech bound to a scene versus independent Studio speech

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/audio-generator/src/speech/SpeechLayerTiming.js

Speech generated for an Express scene can be positioned relative to its connected visual layer. When the speech is shorter than that scene, the timing helper centers it inside the scene. Independent Studio speech marked unbound remains on its own timeline start time and removes connected-layer bindings. Do not assume that all speech automatically fits within a scene: the helper records the actual synthesized duration.


<a id="document-8bbec1562c95316f0ed428bdda13b1f0"></a>
## Video Studio assistant frame attachment

Source class: code_analysis; audience: public; freshness: current.

Sources: production:apps/studio/src/components/video/VideoHome.jsx

Video Studio can submit an optional frameImage with an assistant query. The image is request context, not proof that the assistant can see the complete timeline or automatically perform edits. The submission also carries stream, client_request_id and assistantSessionVersion.


<a id="document-3a7c5f498a7f4301b88e17a884435da0"></a>
## Video generation tariff snapshots

Source class: code_analysis; audience: operator; freshness: current.

Sources: production:services/ai-video-layer-generator/src/billing/FalVideoTariffs.js; production:services/ai-video-layer-generator/src/billing/FalVideoTariffs.js

The AI video layer generator records a tariff version and submission configuration for eligible adapter-priced requests. Duration, resolution and model identity affect the tariff record. These snapshots support settlement against the accepted configuration and must not be reconstructed from a generic current marketing price after a provider job has been accepted.


<a id="document-e40e8301de93620f817a2027d5d2d3a2"></a>
## Video retranslation order and inference settings

Source class: code_analysis; audience: public; freshness: current.

Sources: production:services/processor/src/models/api/VideoSessionTranslateAPI.js; production:services/processor/src/models/api/VideoSessionTranslateAPI.js

Video retranslation translates speech text before the new speech is synthesized. The request resolves effective inference model and reasoning settings, and passes those settings into the translation step. Retranslation is a distinct operation from generating an entirely new video and requires review of translated speech timing against the original scene boundaries.


<a id="document-2fa8fc82012cf775446658fbb2ba9690"></a>
## Vidgenie assistant context in the current client

Source class: code_analysis; audience: operator; freshness: current.

Sources: production:apps/studio/src/components/oneshot_editor/OneshotEditor.jsx

Vidgenie currently submits the session ID, user query, stream flag, client request ID and assistant session version. This submission does not attach a frame image or explicit page/view/render-state metadata. The existing client therefore does not establish the proposed pre-render versus post-render RAG context contract. This is an observed integration gap, not a deployed feature.


<a id="document-1caa7010a87afb89868037ded4f8858b"></a>
## Assistant API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/assistant-api

# Assistant API

Compare [inference models and adapters](/models?modality=inference) before choosing a workflow. The session assistant contract below is distinct from [provider-style completions](/external-requests#chat); available model selections depend on the endpoint.

**Quick facts**

- Base URL: `https://api.samsar.one/v1`
- Route prefix: `/assistant · alias /api/v1/assistant`
- Authentication: `Bearer API key`
- Execution: `Synchronous · OpenAI-compatible Responses payload`
- Billing: `Published input, output, and cached-input token rates`
- Content type: `application/json`

Use this API for assistant behavior tied to an existing Samsar `session_id`. It uses the account's selected assistant model and custom system prompt, or a minimal default prompt. Conversation history is reused across turns. OpenAI Responses-backed calls can also continue a previous response chain; Claude, Gemini, Kimi, and Qwen use their corresponding adapters and session messages.

Choose the contract that matches your integration:

| Contract | Session and response behavior |
| --- | --- |
| `/v1/assistant/completion` | Existing Samsar session; synchronous Responses-compatible JSON. This route does not expose SSE. |
| `/v2/external/chat/completions` and external assistant aliases | Caller-provided messages; JSON, [named SSE events](/external-requests#streaming-completion), or queued polling. |
| Studio popup `/assistants/*` | Signed-in application session; queued replies, SSE snapshots, message deletion, and conversation reset. These are client routes, not aliases for the public API above. |

## Billing and retries

See the final token prices for input, output, and cached-input credits per one million tokens. Choose the row matching your model, adapter, context, and date period. The listed prices also apply to [public external chat/assistant endpoints](/external-requests#external-assistant-and-chat-completions) and [external-user assistants](/external-users#post-external_usersassistantcompletion) on those routes.

Production agent pipeline inference retains its flat stage pricing. Media, narrative, and utility endpoints have their own published rates; see [Models & pricing](/pricing).

Send an `Idempotency-Key` header when retrying a logical request. In `samsar-js`, use `{ idempotencyKey: 'stable-request-id' }` in request options. A stable `client_request_id` is also accepted; when both identifiers are supplied, the client request ID takes precedence. Keys are scoped to the account and request scope, including the session and external identity for session assistants. Use a non-empty string of at most 512 characters.

- The same key and payload return the saved response with the original charge. A changed payload under the same key returns `409`.
- Replayed `x-credits-charged` values describe the original debit; they are not additional charges. Polling does not create another inference charge.
- A request without a stable key is a new submission, even if its text matches an earlier request.

A positive credit balance and sufficient API-key allowance are required before a request starts. The final charge can exceed the available balance; further requests are blocked until credits are restored.

Requests awaiting billing confirmation or completion after a timeout can remain pending. Continue checking the existing request and retry with the same key to avoid a second submission.

### Paid-tool limitations

The token tables cover model tokens only. Image generation, web/file search, hosted code execution, and other paid tools may incur separate charges. Requests using these tools can remain pending until billing is confirmed. Reuse the existing request key while checking completion.

## POST /assistant/set_system_prompt

Store or clear the account-level system prompt used for assistant completions.

**Request body**

```json
{
  "system_prompt": "You are the launch assistant for Acme. Keep answers concise, on-brand, and commercially practical."
}
```

- `system_prompt` optional string.
- Pass `null` or an empty string to clear the custom prompt and revert to Samsar's default prompt.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/assistant/set_system_prompt \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "system_prompt": "You are the launch assistant for Acme. Keep answers concise, on-brand, and commercially practical."
  }'
```

**Success response (200)**

```json
{
  "system_prompt": "You are the launch assistant for Acme. Keep answers concise, on-brand, and commercially practical.",
  "model": "gpt-6-astra",
  "selected_assistant_model": "gpt-6-astra"
}
```

**Common errors**

- `400` invalid payload.
- `401` invalid API key.

---

## POST /assistant/completion

Create a synchronous assistant response for an existing Samsar session. The request returns an OpenAI-compatible Responses payload so it can fit cleanly into modern OpenAI client flows.

You must provide a `session_id`. You can optionally send fresh user input in the same request. If you omit `input`, the assistant responds from the existing session history.

**Request body**

```json
{
  "session_id": "67df0d8ebc4f9d0b7f4fd123",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Write a short product launch caption for this session." }
      ]
    }
  ],
  "max_output_tokens": 300
}
```

- `session_id` required.
- `input` optional:
  - a string
  - a single message object
  - an array of message objects
  - a multimodal content array such as `input_text` and `input_image`
- `max_output_tokens`, `temperature`, `top_p`, `reasoning`, `metadata`, `tools`, and `tool_choice` are accepted when supported by the configured assistant model.
- On an OpenAI Responses-backed route that supports image tools, pass `tools: [{ "type": "image_generation" }]`. To force an image response, set `tool_choice` to `{ "type": "image_generation" }`. Tools are not portable across all adapters. See [Paid-tool limitations](#paid-tool-limitations) for separate charges and pending requests.

**Multimodal example**

```json
{
  "session_id": "67df0d8ebc4f9d0b7f4fd123",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Describe the hero image and turn it into a headline." },
        { "type": "input_image", "image_url": "https://cdn.example.com/launch-hero.png" }
      ]
    }
  ]
}
```

**Image generation example**

```json
{
  "session_id": "67df0d8ebc4f9d0b7f4fd123",
  "input": "Create a clean launch-poster image for this session.",
  "tools": [
    {
      "type": "image_generation",
      "size": "1024x1024",
      "quality": "high"
    }
  ],
  "tool_choice": {
    "type": "image_generation"
  }
}
```

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/assistant/completion \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "67df0d8ebc4f9d0b7f4fd123",
    "input": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "Write a short product launch caption for this session." }
        ]
      }
    ],
    "max_output_tokens": 300
  }'
```

**Success response (200)**

```json
{
  "id": "resp_123",
  "object": "response",
  "created_at": 1773651000,
  "status": "completed",
  "model": "gpt-6-astra",
  "output_text": "Meet the new drop: sharp design, fast story, and a launch-ready look in one line.",
  "output": [
    {
      "id": "resp_123_message",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Meet the new drop: sharp design, fast story, and a launch-ready look in one line.",
          "annotations": []
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 482,
    "output_tokens": 43,
    "total_tokens": 525
  }
}
```

**Image response example**

```json
{
  "id": "resp_456",
  "object": "response",
  "created_at": 1773651300,
  "status": "completed",
  "model": "gpt-6-astra",
  "output": [
    {
      "id": "ig_456",
      "type": "image_generation_call",
      "status": "completed",
      "revised_prompt": "A clean launch poster with a premium layout, strong product focal point, and minimal copy.",
      "result": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ],
  "usage": {
    "input_tokens": 521,
    "output_tokens": 22,
    "total_tokens": 543
  }
}
```

The `result` field contains a base64-encoded image. For follow-up image edits on the same supported OpenAI Responses route, keep using the same `session_id` so the response chain can be continued.

**Headers**

- `x-credits-charged`
- `x-credits-remaining`

**Common errors**

- `400` missing or invalid `session_id`, or invalid `input`.
- `401` invalid API key.
- `402` insufficient credits.
- `403` session does not belong to the authenticated account.
- `404` session not found.
- `409` request already processing or the request key was reused with a different payload.
- `502` billing confirmation is pending; retry with the same request key.
- `503` provider outcome is unknown; inference is retained for reconciliation rather than repeated.

## GPT and Claude model choices

Text inference, vision, and assistant requests support these models at `high` or `xhigh` effort:

| Samsar model | Native provider model | OpenRouter model |
| --- | --- | --- |
| `gpt-6-astra` | `gpt-6-astra` | `openai/gpt-6-astra` |
| `gpt-6.1-sol` | `gpt-6.1-sol` | `openai/gpt-6.1-sol` |
| `claude-opus-5.5` | `claude-opus-5-5` | `anthropic/claude-opus-5.5` |
| `claude-fable-5.1` | `claude-fable-5-1` | `anthropic/claude-fable-5.1` |

Use `OPENAI_API_KEY` for native GPT, `ANTHROPIC_API_KEY` for native Claude, or `OPENROUTER_API_KEY` for OpenRouter. Samsar-hosted requests use `SAMSAR_API_KEY`. Existing defaults remain GPT 6 Astra and `high`; selecting Sol no longer redirects to Astra. Saved `-xhigh` model aliases remain accepted.

For pipeline and narrative calls, set `inference_model` and `effort`. For chat calls, set `model` and `reasoning: { effort: "xhigh" }` (or `"high"`). Account, Vidgenie, and Assistant selectors expose both model families and effort levels; standalone installations show only configured models.

Assistant token rates are listed on the pricing page. High and XHigh use the same per-token rates; total charges depend on actual input, cached input, and output usage. Thinking tokens count as output tokens.


<a id="document-7cb0c452e757f7b5b8aa1bf0f51b79ac"></a>
## Build generative media workflows with one API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/

<span className="docs-eyebrow">SamsarOne developer platform</span>

# Build generative media workflows with one API

Create videos, transform images, generate speech and music, run inference, and publish results through **hosted Samsar.js**. Start with one Samsar API key, then explore supported deployment adapters when you need your own runtime.

  Explore the model matrix
  Start with video
  Open Playground ↗

  <span>Base URL</span>
  <code>https://api.samsar.one/v1</code>
  <span>Bearer authentication</span>

## Choose a workflow

Each workflow starts with the hosted API. The [interactive model matrix](/models) connects model keys to API contracts and compatible adapters; [deployment adapters](/adapters) explains native and standalone options.


    <span className="docs-card-label">Generate</span>
    Video API
    <span>Create, translate, join, reroll, and customize videos.</span>


    <span className="docs-card-label">Transform</span>
    Image API
    <span>Enhance, edit, validate, and organize image assets.</span>


    <span className="docs-card-label">Infer</span>
    Chat API
    <span>Run managed chat, moderation, and embedding workflows.</span>


    <span className="docs-card-label">Assist</span>
    Assistant API
    <span>Build session-aware, multimodal assistant experiences.</span>


    <span className="docs-card-label">Structure</span>
    Narrative API
    <span>Create reusable singular or branching story structures.</span>


    <span className="docs-card-label">Platform</span>
    External users
    <span>Give your customers isolated credits, history, and access.</span>


    <span className="docs-card-label">Sound</span>
    Speech, music & transcripts
    <span>Generate narration, backing tracks and effects; align transcripts.</span>


    <span className="docs-card-label">Perform</span>
    Lip sync & video sound
    <span>Compare models for matching speech and adding sound to video.</span>


## Make your first request

Install the client in your server application:

```bash
npm install samsar-js
```

```js title="Hosted Samsar.js: discover models, then create a video"

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const models = await samsar.getSupportedTextToVideoModels();
console.log(models.data); // Check the available image and video selections.

const job = await samsar.createVideoFromText({
  prompt: 'A cinematic product reveal in a quiet gallery.',
  duration: 10,
  aspect_ratio: '16:9',
  image_model: 'GPTIMAGE2.5',
  video_model: 'RUNWAYML',
});
// Persist the ID; generation continues asynchronously.
console.log(job.data.request_id);
```

Follow the [status contract](/video#get-status) to poll to completion or configure a webhook. To use a local deployment, see [the adapter guide](/adapters#choose-your-path).

Prefer HTTP? Follow the equivalent request flow


    <span>1</span>
    Create an API keyGenerate a key in Samsar Studio and keep it on your server. Never expose it in browser code.


    <span>2</span>
    Check express model availabilityThe video-generation allowlist can vary with the providers configured for a deployment.


```bash title="List express models available to this deployment"
curl "https://api.samsar.one/v1/video/supported_models"
```


    <span>3</span>
    Submit work and track usageSend your key as a bearer token. Asynchronous generation routes return a request ID; poll the documented status route or provide a webhook.


```bash title="Create a video"
curl -X POST "https://api.samsar.one/v1/video/text_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "A cinematic product reveal in a quiet gallery.",
      "duration": 10,
      "aspect_ratio": "16:9",
      "image_model": "GPTIMAGE2.5",
      "video_model": "RUNWAYML"
    }
  }'
```

:::tip Read credit headers
When an endpoint deducts credits, inspect `x-credits-charged` and `x-credits-remaining`. See [Models & pricing](/pricing) for current rates and billing units.
:::

## Pick the right API surface

| Surface | Use it when… | Base path |
| --- | --- | --- |
| Core APIs | One Samsar account owns and submits the work. | `/v1/video`, `/v1/image`, `/v1/chat`, `/v1/assistant` |
| V2 API | One client needs a unified surface for internal and external-user actors. | `/v2` |
| External users | Your platform needs per-customer credits, history, and login state. | `/v1/external_users` |
| External requests | A deployment uses Samsar as a managed fallback provider. | `/v2/external` |
| Narrative API | You want story structure first and media rendering later. | `/v2/external/narrative` |

## Before you ship

- Keep API keys in server-side secrets.
- Store every asynchronous `request_id` before starting a polling loop.
- Reuse stable client request IDs where an endpoint supports idempotent retries.
- Query runtime model availability instead of hard-coding a deployment-wide assumption.
- Treat credit headers as the final billed amount; estimates can change with duration and optional stages.


<a id="document-a8ea66ae7d93b398a22b16b968367532"></a>
## Chat API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/chat-api

# Chat API

Explore the [inference and vision matrix](/models?modality=inference) and [embedding services](/models?modality=embeddings). Hosted **samsar-js** is the common client; native inference and local search requirements are covered in the [adapter guide](/adapters).

Send a sample prompt with your API key in the Playground to see how the `/chat/enhance` response is formatted.

**Quick facts**

- Base URL: `https://api.samsar.one/v1`
- Route prefix: `Managed inference: /v2/external`
- Authentication: `Bearer API key`
- Execution: `Core chat is synchronous; managed inference also supports polling`
- Billing: `Flat, token-based, or free by route`

`/chat/enhance` costs **30 credits/request**. Managed chat uses token-based adapter rates, moderation is free, and embedding costs scale with processed text. See the managed inference rate tables for a compact comparison.

## POST /chat/enhance

Improve a message while keeping its intent. `metadata` is optional contextual data that influences the rewrite.
Provide `language` (ISO 639-1 code or language name) if you want the output in a specific language; otherwise detection is automatic.

**Request body**

```json
{
  "message": "Draft caption text",
  "metadata": {
    "audience": "gen z",
    "tone": "playful"
  },
  "language": "FR"
}
```

- `message` required, non-empty string.
- `metadata` optional object.
- `language` optional string, ISO 639-1 code (e.g., `EN`, `FR`, `TH`) or language name; defaults to auto-detect.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/chat/enhance \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "launching soon, stay tuned!",
    "metadata": { "channel": "instagram" },
    "language": "FR"
  }'
```

**Success response (200)**

```json
{
  "content": "We’re launching soon—follow along for first looks and drop reminders!"
}
```

**Common errors**

- `400` missing or empty `message`.
- `401` invalid API key.
- `402` insufficient credits.

---

## POST /v2/external/chat/completions

Create an OpenAI-compatible chat completion billed through Samsar credits. Use this endpoint when an external deployment or integration needs managed inference without supplying native OpenAI or Google credentials. The same handler is available at `/v2/external/chat`, `/v2/external/assistant`, and `/v2/external/assistant/completions`; `/api/v2/external/*` is also supported.

This endpoint returns JSON by default. Set `stream: true` for [Samsar named SSE events](/external-requests#streaming-completion), or use [queued polling](/external-requests#queued-completion-with-polling) for durable asynchronous submission. Streaming and polling cannot be combined. The external reference also defines request keys, retries, and completion receipts.

**Pricing**

See the final token prices for input, output, and cached-input credits per one million tokens, including context and date periods for the listed adapters. Session assistants and public chat/assistant aliases share these rates on the listed routes. Production agent pipeline inference keeps its flat pricing. `QWEN3.8` uses Qwen 3.8 Max for both text and vision.

Vision uses the same adapter rates for image-derived input and generated output tokens. Responses include `x-credits-charged` and `x-credits-remaining` when credits are deducted.

Use the same `Idempotency-Key` header or `client_request_id` when retrying one logical submission. In `samsar-js`, pass `{ idempotencyKey: 'stable-request-id' }` in request options. Completed replays return the original charge without another debit; a changed payload under the same key returns `409`. When both identifiers are supplied, the client request ID takes precedence. Polling is free.

Requests awaiting billing confirmation or completion after a timeout can remain pending. Reuse the same request key while checking completion. Paid tools may incur separate charges; see [Assistant billing and retries](/assistant-api#billing-and-retries).

**Request body**

```json
{
  "model": "gpt-6-astra",
  "messages": [
    { "role": "developer", "content": "Return concise JSON." },
    { "role": "user", "content": "Create a three-scene outline for a launch video." }
  ],
  "response_format": { "type": "json_object" }
}
```

For vision, send OpenAI-compatible image message parts:

```json
{
  "model": "gemini-4-argon",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Describe this image for a video prompt." },
        { "type": "image_url", "image_url": { "url": "https://example.com/frame.png" } }
      ]
    }
  ]
}
```

**Sample request**

```bash
curl -X POST https://api.samsar.one/v2/external/chat/completions \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-6-astra",
    "messages": [
      { "role": "user", "content": "Write one cinematic product video theme." }
    ]
  }'
```

**Success response (200)**

The response is an OpenAI-compatible chat completion object.

Queued mode instead returns HTTP `202` with `request_id`, `status`, and `poll_url`. The default server execution timeout is 10 minutes; polling avoids holding the HTTP connection for that entire period.

**Common errors**

- `400` missing or invalid `messages`.
- `401` invalid API key.
- `402` insufficient credits.

---

## POST /v2/external/moderation

Create an OpenAI-compatible moderation check for external deployments. The same handler is available at `/external/moderations`, `/v2/external/moderation`, and `/v2/external/moderations`.

This route requires a Samsar API key but does not charge credits.

**Request body**

```json
{
  "input": "A user prompt or generated draft to moderate.",
  "model": "omni-moderation-latest"
}
```

**Sample request**

```bash
curl -X POST https://api.samsar.one/v2/external/moderation \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Create a family-safe product launch video."
  }'
```

**Success response (200)**

The response includes the OpenAI-compatible moderation result plus a `decision` object with the normalized Samsar pass/fail decision.

**Common errors**

- `400` missing or invalid `input`.
- `401` invalid API key.
- `500` moderation provider is not configured.

---

## POST /chat/create_embedding

Create a new embedding template from either a JSON array or a URL list. JSON records are embedded directly. URL inputs are first crawled with Firecrawl, minimally cleaned, normalized into the same compatible record structure, and then embedded using `text-embedding-3-large`.

**Request body**

```json
{
  "name": "listings",
  "records": [
    {
      "id": "A1",
      "city": "Austin",
      "price": 1800,
      "duration": 12,
      "description": "Modern 1BR close to downtown."
    }
  ]
}
```

- `records` required when embedding JSON input.
- `urls` or `url` can be used instead of `records` to build embeddings from crawled web pages.
- `name` optional string. Also accepted: `embedding_name`, `template_name`.
- Each record should include an `id`, `_id`, or equivalent identifier. If missing, the API generates one per record.
- `field_options` optional map (or array) of per-field flags:
  - `searchable: false` excludes the field (and nested paths) from embedding input.
  - `filterable: true` includes the field in structured filters used for search/similar queries.
  - `filterable: false` excludes the field from structured filters.
  - `retrievable: false` removes the field from raw `record` payloads in search results.
  - Use dot notation (e.g. `owner.email`) for nested fields.

You can also inline flags in records using a `{ value, searchable, filterable, retrievable }` wrapper.

```json
{
  "records": [
    {
      "id": "A1",
      "internal_notes": { "value": "private note", "searchable": false, "retrievable": false }
    }
  ]
}
```

**URL request body**

```json
{
  "name": "product-docs",
  "urls": [
    "https://example.com/docs/getting-started",
    "https://example.com/docs/pricing"
  ]
}
```

- URL mode crawls each URL with Firecrawl before embedding.
- Optional `levels` controls crawl depth for URL mode. It can be passed as a query param or body field.
  - `1`: crawl only the listed seed URLs.
  - `2`: crawl each seed URL plus URLs linked directly from it.
  - `3`: crawl each seed URL plus two link hops outward.
  - Default: `2`. Maximum: `3`.
- URL mode is capped at `50` total crawled pages per request across all seed URLs.
- Returned embeddings remain compatible with `/chat/search_against_embedding` and `/chat/similar_to_embedding`.
- URL mode responses may include `input_url_count`, `processed_url_count`, `firecrawl_credits_used`, `skipped_urls`, and `crawl_errors`.

**Sample request**

```bash
curl -X POST "https://api.samsar.one/v1/chat/create_embedding?levels=2" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "listings",
    "field_options": {
      "description": { "searchable": true },
      "internal_notes": { "searchable": false, "retrievable": false },
      "price": { "filterable": true }
    },
    "records": [
      { "id": "A1", "city": "Austin", "price": 1800, "description": "Modern 1BR close to downtown." },
      { "id": "A2", "city": "Dallas", "price": 2200, "description": "Spacious 2BR with a balcony." }
    ]
  }'
```

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "template_hash": "b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "hash_link": "embedding_template:b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "record_count": 2,
  "structured_fields": [
    { "key": "city", "type": "string" },
    { "key": "price", "type": "number" }
  ],
  "unstructured_fields": ["description"]
}
```

**Common errors**

- `400` missing `records` and `urls`, or invalid URL input.
- `401` invalid API key.
- `402` insufficient credits.

---

## POST /chat/create_embedding_from_url

Create a new embedding template from one URL or a URL list. This is the explicit URL-only variant of `/chat/create_embedding` and uses the same Firecrawl-backed ingestion flow.

**Request body**

```json
{
  "name": "product-docs",
  "urls": [
    "https://example.com/docs/getting-started",
    "https://example.com/docs/pricing"
  ]
}
```

- `urls` required array of URL strings. `url` is also accepted for a single URL.
- Optional `levels` controls crawl depth for URL mode. It can be sent as a query param or body field.
  - `1`: crawl only the listed seed URLs.
  - `2`: crawl each seed URL plus URLs linked directly from it.
  - `3`: crawl each seed URL plus two link hops outward.
  - Default: `2`. Maximum: `3`.
- URL mode is capped at `50` total crawled pages per request across all seed URLs.
- `field_options` is optional and follows the same rules as `/chat/create_embedding`.
- Samsar crawls the URLs, minimally cleans the extracted text, stores normalized URL metadata, and creates embeddings in the same query-compatible format as JSON-record embeddings.
- Embedding input costs **250 credits per 1M tokens**. Crawling costs **2.25 credits per Firecrawl credit** consumed.

**Sample request**

```bash
curl -X POST "https://api.samsar.one/v1/chat/create_embedding_from_url?levels=2" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "product-docs",
    "urls": [
      "https://example.com/docs/getting-started",
      "https://example.com/docs/pricing"
    ]
  }'
```

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "template_hash": "b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "hash_link": "embedding_template:b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "record_count": 2,
  "input_url_count": 2,
  "processed_url_count": 12,
  "firecrawl_credits_used": 12,
  "crawl_levels": 2,
  "max_links": 50,
  "structured_fields": [
    { "key": "hostname", "type": "string" },
    { "key": "status_code", "type": "number" }
  ],
  "unstructured_fields": ["title", "description", "content"]
}
```

**Common errors**

- `400` missing or invalid `urls`.
- `401` invalid API key.
- `402` insufficient credits.
- `422` URLs crawled successfully but produced no extractable content.
- `5xx` Firecrawl crawl failure or upstream processing failure.

---

## POST /chat/generate_embeddings_from_plain_text

Create a new embedding template from already cleaned plain text input. This route is the embedding-only stage of the URL ingestion flow: you provide the cleaned text directly, Samsar skips crawling, and it stores the result in the same query-compatible embedding format used by the JSON and URL endpoints.

**Request body**

```json
{
  "name": "product-docs-clean",
  "plain_text": [
    {
      "url": "https://example.com/docs/getting-started",
      "title": "Getting Started",
      "content": "Cleaned plain text content from the page."
    }
  ]
}
```

- `plain_text` required. Accepted shapes:
  - a single string
  - a single object
  - an array of strings or objects
- For object entries, the cleaned text can be provided in `plain_text`, `content`, `text`, `cleaned_text`, `markdown`, or `body`.
- Optional object fields such as `url`, `title`, `description`, and `language` are preserved and normalized into the stored record when present.
- `field_options` is optional and follows the same rules as `/chat/create_embedding`.
- Embedding input costs **250 credits per 1M tokens**. There is no crawl charge.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/chat/generate_embeddings_from_plain_text \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "product-docs-clean",
    "plain_text": [
      {
        "url": "https://example.com/docs/getting-started",
        "title": "Getting Started",
        "content": "Cleaned plain text content from the page."
      },
      {
        "url": "https://example.com/docs/pricing",
        "title": "Pricing",
        "content": "Cleaned pricing page text."
      }
    ]
  }'
```

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "template_hash": "b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "hash_link": "embedding_template:b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "record_count": 2,
  "structured_fields": [
    { "key": "hostname", "type": "string" }
  ],
  "unstructured_fields": ["title", "content"]
}
```

**Common errors**

- `400` missing or invalid `plain_text`.
- `401` invalid API key.
- `402` insufficient credits.

---

## POST /chat/update_embedding

Append or update records for an existing template. New records are embedded and merged into the template schema; matching `sourceId` records are upserted.

**Request body**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "field_options": {
    "description": { "searchable": true },
    "internal_notes": { "searchable": false, "retrievable": false },
    "price": { "filterable": true }
  },
  "records": [
    {
      "id": "A3",
      "city": "Houston",
      "price": 2000,
      "description": "Bright 2BR near the park."
    }
  ]
}
```

`field_options` follows the same rules as `/chat/create_embedding`. If omitted, the template's existing field options are reused.

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "template_hash": "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1908",
  "record_count": 3,
  "structured_fields": [
    { "key": "city", "type": "string" },
    { "key": "price", "type": "number" }
  ],
  "unstructured_fields": ["description"]
}
```

**Common errors**

- `400` missing `template_id` or `records`.
- `401` invalid API key.
- `402` insufficient credits.
- `404` template not found.

---

## POST /chat/delete_embeddings

Delete all embeddings for a template. The template remains, but its record count becomes 0.

**Request body**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3"
}
```

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "deleted_count": 250,
  "record_count": 0,
  "status": "empty"
}
```

**Common errors**

- `400` missing `template_id`.
- `401` invalid API key.
- `404` template not found.

---

## POST /chat/delete_embedding

Delete one or more embeddings from a template by record id. Use the `id` returned in search results or the `id` you supplied in the original records.

**Request body**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "source_id": "A2"
}
```

- `source_id` optional string. Also accepted: `sourceId`, `id`, `record_id`.
- `source_ids` optional array of strings. Also accepted: `sourceIds`, `ids`, `record_ids`.
- Provide either `source_id` or `source_ids`.

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "deleted_count": 1,
  "record_count": 249,
  "status": "ready"
}
```

**Common errors**

- `400` missing `template_id` or `source_id`/`source_ids`.
- `401` invalid API key.
- `404` template not found.

---

## POST /chat/search_against_embedding

Search within a template using a natural language query. The API extracts structured filters first, then performs vector similarity. Optional rerank can re-order top results.

**Request body**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "search_term": "2 bedroom apartment in Dallas under 2500",
  "search_params": { "city": "Dallas", "price": { "max": 2500 } },
  "limit": 10,
  "num_candidates": 50,
  "rerank": true,
  "include_raw": true
}
```

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "template_name": "listings",
  "structured_filters": { "city": "Dallas", "price": 2500 },
  "results": [
    {
      "id": "A2",
      "score": 0.92,
      "structured_filters": { "city": "Dallas", "price": 2200 },
      "record": {
        "id": "A2",
        "city": "Dallas",
        "price": 2200,
        "description": "Spacious 2BR with a balcony."
      }
    }
  ]
}
```

- Optional `structured_filters` (or `filters`) can be supplied to force filters.
- Optional `search_params` (or `searchParams`) supplies a filter payload validated against the template schema and applied before vector search. `structured_filters` overrides overlapping keys.
- Use `include_raw: false` to omit the original record payloads.

**Common errors**

- `400` missing `template_id` or `search_term`.
- `401` invalid API key.
- `402` insufficient credits.
- `404` template not found.

---

## POST /chat/similar_to_embedding

Return similar results for a query within a template (vector similarity only). You can pass a natural language `search_term` or a JSON payload in `search_json` which is converted into the template's search document before embedding.

**Request body**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "search_term": "modern downtown apartment",
  "search_params": { "city": "Austin" },
  "limit": 10,
  "min_results": 10
}
```

**Request body (JSON search)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "search_json": {
    "city": "Austin",
    "price": 2000,
    "description": "modern downtown apartment"
  },
  "limit": 10
}
```

- Provide `search_term` or `search_json`.
- Optional `search_params` (or `searchParams`) prefilters by structured fields (validated against the template schema) before vector similarity.
- Optional `min_results` ensures at least that many results are requested (may still return fewer if the template has fewer matches).

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "structured_filters": {},
  "matches": [
    { "id": "A1", "score": 0.88 },
    { "id": "A2", "score": 0.73 }
  ]
}
```

**Common errors**

- `400` missing `template_id` or `search_term`/`search_json`.
- `401` invalid API key.
- `402` insufficient credits.
- `404` template not found.

---

## GET /chat/embedding_templates

List embedding templates available for the API key.

**Query params**

- `limit` optional integer (default 50, max 100).
- `offset` optional integer (default 0).

**Sample request**

```bash
curl -X GET "https://api.samsar.one/v1/chat/embedding_templates?limit=25&offset=0" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Success response (200)**

```json
{
  "templates": [
    {
      "template_id": "66f3b0d64c8bca9c6f2bd1a3",
      "name": "listings",
      "template_hash": "b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
      "hash_link": "embedding_template:b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
      "record_count": 3,
      "structured_fields": [
        { "key": "city", "type": "string" },
        { "key": "price", "type": "number" }
      ],
      "unstructured_fields": ["description"],
      "embedding_model": "text-embedding-3-large",
      "created_at": "2024-11-03T12:00:00.000Z",
      "updated_at": "2024-11-03T12:10:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 25,
    "offset": 0,
    "has_more": false
  }
}
```

**Common errors**

- `401` invalid API key.

---

## GET /chat/embedding_status

Check whether embeddings exist for a template id.

**Query params**

- `template_id` required string.

**Sample request**

```bash
curl -X GET "https://api.samsar.one/v1/chat/embedding_status?template_id=66f3b0d64c8bca9c6f2bd1a3" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Success response (200)**

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "has_embeddings": true,
  "record_count": 3,
  "status": "ready"
}
```

**Common errors**

- `400` missing `template_id`.
- `401` invalid API key.
- `404` template not found.

## GPT and Claude model choices

Text inference, vision, and assistant requests support these models at `high` or `xhigh` effort:

| Samsar model | Native provider model | OpenRouter model |
| --- | --- | --- |
| `gpt-6-astra` | `gpt-6-astra` | `openai/gpt-6-astra` |
| `gpt-6.1-sol` | `gpt-6.1-sol` | `openai/gpt-6.1-sol` |
| `claude-opus-5.5` | `claude-opus-5-5` | `anthropic/claude-opus-5.5` |
| `claude-fable-5.1` | `claude-fable-5-1` | `anthropic/claude-fable-5.1` |

Use `OPENAI_API_KEY` for native GPT, `ANTHROPIC_API_KEY` for native Claude, or `OPENROUTER_API_KEY` for OpenRouter. Samsar-hosted requests use `SAMSAR_API_KEY`. Existing defaults remain GPT 6 Astra and `high`; selecting Sol no longer redirects to Astra. Saved `-xhigh` model aliases remain accepted.

For pipeline and narrative calls, set `inference_model` and `effort`. For chat calls, set `model` and `reasoning: { effort: "xhigh" }` (or `"high"`). Account, Vidgenie, and Assistant selectors expose both model families and effort levels; standalone installations show only configured models.

Assistant token rates are listed on the pricing page. High and XHigh use the same per-token rates; total charges depend on actual input, cached input, and output usage. Thinking tokens count as output tokens.


<a id="document-cc4a47c3e67cb0f70a590703b3ea9762"></a>
## Create a branching narrative

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/narrative/create-branching

# Create a branching narrative

`POST /v2/external/narrative/create_branching`

Expand a completed [`create_single`](/narrative/create-single) request into a binary tree of alternate narrative paths. The source narrative remains unchanged. Samsar creates a separate `NarrativeRequest` with `narrative_type: "branched"` and returns HTTP `202` as soon as the new request has been persisted.

This endpoint performs narrative inference only. It does not create a `VideoSession` or generate image, speech, audio, or video media. After it completes, pass its request ID to [Render a narrative as video](/narrative/render-video) when you want one final video per leaf path.

## Request body

```json
{
  "narrative_request_id": "687b3df76a8d56c94ab32100",
  "num_levels": 1
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `narrative_request_id` | string | Yes | ID of the completed singular `NarrativeRequest` to branch. It must belong to the authenticated user. |
| `num_levels` | integer | Yes | Number of binary branching levels to generate. The standard maximum is `3`, and it cannot exceed the source scene count minus one. |

The new request inherits the source request's prompt, duration, inference model, and speaker configuration. Samsar also stores an immutable snapshot of the source prompt, duration, model, theme, narrative, and movie resource list for branching and recovery. Do not send a new `prompt` or `inference_model` in this request.

`narrativeRequestId`, `request_id`, `requestId`, and `id` are accepted as compatibility aliases for `narrative_request_id`. `numLevels` is accepted as an alias for `num_levels`. The fields may also be placed inside a top-level `input` object, but new integrations should use the flat body above.

## Source requirements

The source must:

- belong to the authenticated user;
- have `request_type: "create_single"` and `narrative_type: "singular"`;
- have reached `COMPLETED` with a successful generation outcome;
- contain valid `themeJson`, `narrativeJson`, and `movieResourceList` artifacts;
- contain at least two scenes and a sounds list; and
- contain enough scenes to place every requested branching level at a distinct index.

The request is rejected before a new item is created if these requirements are not met. A positive credit balance is also required at submission and when queued inference begins.

## Submit a request

```bash
curl -X POST "https://api.samsar.one/v2/external/narrative/create_branching" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "narrative_request_id": "687b3df76a8d56c94ab32100",
    "num_levels": 1
  }'
```

## samsar-js

The polling helper submits the branching request and resolves with the completed typed tree:

```ts

const samsar = new SamsarClient({
  apiKey: process.env.SAMSAR_API_KEY!,
});

const result = await samsar.createV2ExternalBranchingNarrativeAndPoll(
  {
    narrative_request_id: '687b3df76a8d56c94ab32100',
    num_levels: 1,
  },
  {
    pollIntervalMs: 2_000,
    pollTimeoutMs: 10 * 60 * 1_000,
  },
);

const { movieResourceList, branchingMeta, billing } = result.data;
```

To persist the new request ID before polling, use the lower-level methods:

```ts
const queued = await samsar.createV2ExternalBranchingNarrative({
  narrative_request_id: '687b3df76a8d56c94ab32100',
  num_levels: 1,
});

const completed = await samsar.pollV2ExternalNarrative(
  queued.data.request_id,
  { pollIntervalMs: 2_000 },
);
```

The generic narrative status and polling helpers work with both singular and branched requests. Polling helpers throw `SamsarRequestError` if a request reaches `FAILED`, polling is aborted, or the timeout is reached.

## Accepted response

HTTP `202`:

```json
{
  "request_id": "687b4127b503e2b4acdf9876",
  "requestId": "687b4127b503e2b4acdf9876",
  "request_type": "create_branching",
  "narrative_type": "branched",
  "status": "PENDING",
  "poll_url": "/v2/external/narrative/status?request_id=687b4127b503e2b4acdf9876",
  "prompt": "A grounded short film about a night market waking before dawn.",
  "duration": 45,
  "inference_model": "gemini-4-argon",
  "source_narrative_request_id": "687b3df76a8d56c94ab32100",
  "num_levels": 1,
  "created_at": "2026-07-19T10:00:00.000Z",
  "updated_at": "2026-07-19T10:00:00.000Z"
}
```

Persist the new `request_id`, not the source ID. `poll_url` is a relative canonical path.

## Poll the request

```bash
curl "https://api.samsar.one/v2/external/narrative/status?request_id=687b4127b503e2b4acdf9876" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

The canonical status route accepts `request_id`, `requestId`, or `id` as the query parameter. Branch-specific aliases are also available:

- `GET /v2/external/narrative/create_branching/status?request_id=...`
- `GET /v2/external/narrative/{request_id}/status`
- `GET /v2/external/narrative/create_branching/{request_id}/status`

Polling returns HTTP `200` for every stored state:

| Status | Meaning |
| --- | --- |
| `PENDING` | The request is persisted and waiting for the user's narrative-processing slot. |
| `PROCESSING` | Divergence planning, branch generation, validation, or usage settlement is in progress. |
| `COMPLETED` | Terminal success. The complete tree and branching metadata are available. |
| `FAILED` | Terminal failure. Inspect `error` and `billing`; provider work already completed can remain billable. |

Requests can recover from processor restarts using stored checkpoints. Continue polling the same new request ID while its state is non-terminal.

## Tree structure

The completed `movieResourceList` is a binary tree rather than the linear `{ scenes, sounds }` object returned by `create_single`:

```json
{
  "structureType": "branched",
  "schemaVersion": 1,
  "rootNodeId": "root",
  "numLevels": 1,
  "branchingFactor": 2,
  "branchSceneIndices": [1],
  "nodes": [
    {
      "nodeId": "root",
      "parentNodeId": null,
      "childNodeIds": ["root.1", "root.2"],
      "level": 0,
      "childIndex": null,
      "branchOrdinal": null,
      "divergence": null,
      "scenes": ["...complete source scenes..."],
      "sounds": ["...complete source sounds..."]
    },
    {
      "nodeId": "root.1",
      "parentNodeId": "root",
      "childNodeIds": [],
      "level": 1,
      "childIndex": 0,
      "branchOrdinal": 1,
      "divergence": {
        "divergenceSceneIndex": 1,
        "path_name": "Riverside Awakening",
        "path_description": "The story follows the community gathering at the river."
      },
      "scenes": ["...complete branch scenes..."],
      "sounds": ["...complete branch sounds..."]
    },
    {
      "nodeId": "root.2",
      "parentNodeId": "root",
      "childNodeIds": [],
      "level": 1,
      "childIndex": 1,
      "branchOrdinal": 2,
      "divergence": {
        "divergenceSceneIndex": 1,
        "path_name": "Soi Sunrise Ritual",
        "path_description": "The story remains in the neighborhood as its morning rituals unfold."
      },
      "scenes": ["...complete branch scenes..."],
      "sounds": ["...complete branch sounds..."]
    }
  ],
  "branchPoints": [
    {
      "branchPointId": "branch-point:root",
      "parentNodeId": "root",
      "level": 1,
      "divergenceSceneIndex": 1,
      "status": "COMPLETED",
      "divergencePaths": [
        {
          "childNodeId": "root.1",
          "path_name": "Riverside Awakening",
          "path_description": "The story follows the community gathering at the river."
        },
        {
          "childNodeId": "root.2",
          "path_name": "Soi Sunrise Ritual",
          "path_description": "The story remains in the neighborhood as its morning rituals unfold."
        }
      ]
    }
  ]
}
```

### Reading the tree

- `root` is the source `movieResourceList`. Its first children are `root.1` and `root.2`; deeper IDs extend the path, such as `root.1.1` and `root.1.2`.
- `branchSceneIndices` contains zero-based scene indexes. A value of `1` means the child preserves scenes and sounds through scene index `1`, then diverges after it.
- Branch points are distributed at approximately equal intervals. For a nine-scene source with `num_levels: 2`, the indexes are `[2, 5]`, meaning branches occur after scene numbers 3 and 6.
- `childIndex` is zero-based within its parent. `branchOrdinal` and the numeric segment in `nodeId` are one-based.
- Every node contains a complete `scenes` list and a complete `sounds` list for that path. Consumers do not need to reconstruct a child by joining it to its parent.
- Every child preserves its parent's scenes and sounds through the divergence index, including that indexed scene. The remaining suffix follows `path_description` and retains the source actors and timeline.
- Each non-leaf node has exactly two complementary children. A tree with `n` levels contains `2^(n + 1) - 1` complete nodes.

`branchPoints` records the two path choices generated for every expanded parent. The completed response also returns `branchingMeta`, a compact projection containing `rootNodeId`, `branchSceneIndices`, `branchPoints`, `leafNodeIds`, and `nodeCount`.

## Completed response

```json
{
  "request_id": "687b4127b503e2b4acdf9876",
  "request_type": "create_branching",
  "narrative_type": "branched",
  "status": "COMPLETED",
  "source_narrative_request_id": "687b3df76a8d56c94ab32100",
  "num_levels": 1,
  "themeJson": {
    "...": "copied source theme fields"
  },
  "narrativeJson": {
    "...": "copied source narrative fields"
  },
  "movieResourceList": {
    "structureType": "branched",
    "rootNodeId": "root",
    "nodes": ["...complete tree nodes..."],
    "branchPoints": ["...completed branch points..."]
  },
  "branchingMeta": {
    "schemaVersion": 1,
    "numLevels": 1,
    "branchingFactor": 2,
    "rootNodeId": "root",
    "branchSceneIndices": [1],
    "branchPoints": ["...completed branch points..."],
    "leafNodeIds": ["root.1", "root.2"],
    "nodeCount": 3
  },
  "billing": {
    "credits_charged": 3.3946,
    "remaining_credits": 996.6054,
    "usage": {
      "inputTokens": 16252,
      "outputTokens": 10081,
      "cachedInputTokens": 0,
      "reasoningTokens": 8668
    }
  },
  "creditsCharged": 3.3946,
  "remainingCredits": 996.6054,
  "completed_at": "2026-07-19T10:00:28.000Z"
}
```

The completed branched request keeps the source `themeJson` and `narrativeJson`. Its `movieResourceList` is the new validated tree. The tree remains stored on `NarrativeRequest`; the narrative-to-video route validates and converts it into a branch-aware `VideoSession` render plan.

## Billing

The status response reports the final customer charge in `creditsCharged` and the remaining balance in `remainingCredits`.

Metered work includes:

- the divergence-planning call for every expanded parent node;
- both child-branch generation calls for every expanded parent node;
- every additional provider call made after structural or semantic validation fails; and
- all inference retries that contribute to a completed or failed request.

The final charge reflects work across the complete tree, including validation and retries, rather than only the last successful response.

Calls completed before a terminal failure remain billable. A request can fail if billing cannot be confirmed. The final charge can exceed the balance available at submission, so `remaining_credits` can become negative.

When available, polling responses include the `billing` object plus `x-credits-charged` and `x-credits-remaining` response headers.

## Failure and HTTP semantics

Submission errors are returned synchronously and do not create a branching request:

- `400` missing or invalid `narrative_request_id` or `num_levels`; the requested levels exceed the source's available scene indexes.
- `401` invalid or expired credentials.
- `402` insufficient credits or an API-key usage limit was reached.
- `403` the supplied credential type is not supported.
- `404` the authenticated user or owned source narrative was not found.
- `409` the source narrative has not completed.
- `422` the source is not singular and successful, or its stored artifacts are invalid.
- `503` narrative persistence or billing indexes are temporarily unavailable.

Inference, validation, usage, and settlement failures that happen after HTTP `202` are stored on the new request. Polling still returns HTTP `200`, with `status: "FAILED"` and the original status and machine-readable code inside `error`:

```json
{
  "request_id": "687b4127b503e2b4acdf9876",
  "request_type": "create_branching",
  "narrative_type": "branched",
  "status": "FAILED",
  "source_narrative_request_id": "687b3df76a8d56c94ab32100",
  "num_levels": 1,
  "error": {
    "message": "Branching narrative generation failed.",
    "code": "BRANCHING_TREE_VALIDATION_FAILED",
    "status": 502
  },
  "billing": {
    "credits_charged": 1.2,
    "remaining_credits": 998.8,
    "usage": {
      "inputTokens": 2400,
      "outputTokens": 300,
      "cachedInputTokens": 0,
      "reasoningTokens": 100
    }
  }
}
```

## What this endpoint does not do

`create_branching` stops after the narrative tree and its metadata have been generated, validated, stored, and metered. It does not:

- modify the source singular `NarrativeRequest`;
- create or update a `VideoSession`;
- generate or edit images;
- generate speech, sound effects, music, or other audio files; or
- generate, assemble, or publish video.


<a id="document-61f2fe8c8811304047f9df46f30009a5"></a>
## Create a single narrative

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/narrative/create-single

# Create a single narrative

`POST /v2/external/narrative/create_single`

Generate the structured output of the text-to-video prompt-generation stage without creating a `VideoSession` or starting media generation. The request runs asynchronously and returns HTTP `202` as soon as it has been persisted.

## Request body

```json
{
  "prompt": "A grounded short film about a night market waking before dawn.",
  "duration": 45,
  "inference_model": "GPT6"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | Yes | Narrative direction. Leading and trailing whitespace is removed. Maximum length: 4,000 characters. |
| `duration` | number | Yes | Target narrative duration in seconds, from `10` through `240`. This guides narrative structure; it does not render media. |
| `inference_model` | string | No | Inference model for the prompt-generation workflow. Omit it to use the authenticated user's selected inference model. |

The canonical model names and concise aliases are:

| Request value | Stored model |
| --- | --- |
| `GPT6` or `gpt-6-astra` | `gpt-6-astra` |
| `gpt-6.1-sol` | `gpt-6.1-sol` |
| `claude-opus-5.5` | `claude-opus-5.5` |
| `claude-fable-5.1` | `claude-fable-5.1` |
| `GEMINI4ARGON` or `gemini-4-argon` | `gemini-4-argon` |
| `QWEN3.8` | `QWEN3.8` |

GPT and Claude models accept `effort: "high"` or `effort: "xhigh"`. Omitted settings preserve the saved model and effort; the installation defaults remain GPT 6 Astra and High.

`QWEN3.8` selects Qwen 3.8 Max for both inference and vision input.

`inferenceModel` is accepted as a compatibility alias for `inference_model`. The request fields may also be placed inside a top-level `input` object, but new integrations should use the flat body shown above.

## Submit a request

```bash
curl -X POST "https://api.samsar.one/v2/external/narrative/create_single" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A grounded short film about a night market waking before dawn.",
    "duration": 45,
    "inference_model": "GEMINI4ARGON"
  }'
```

## samsar-js

The polling helper submits the request and resolves with the completed, typed artifact response:

```ts

const samsar = new SamsarClient({
  apiKey: process.env.SAMSAR_API_KEY!,
});

const result = await samsar.createV2ExternalSingleNarrativeAndPoll(
  {
    prompt: 'A grounded short film about a night market waking before dawn.',
    duration: 45,
    inference_model: 'GEMINI4ARGON',
  },
  {
    pollIntervalMs: 2_000,
    pollTimeoutMs: 10 * 60 * 1_000,
  },
);

const { themeJson, narrativeJson, movieResourceList, billing } = result.data;
```

To persist the request ID before polling, use the lower-level methods:

```ts
const queued = await samsar.createV2ExternalSingleNarrative({
  prompt: 'A grounded short film about a night market waking before dawn.',
  duration: 45,
  inference_model: 'GEMINI4ARGON',
});

const completed = await samsar.pollV2ExternalNarrative(
  queued.data.request_id,
  { pollIntervalMs: 2_000 },
);
```

The polling helpers throw `SamsarRequestError` when the request reaches `FAILED`, polling is aborted, or the polling timeout is reached.

## Accepted response

HTTP `202`:

```json
{
  "request_id": "687b3df76a8d56c94ab32100",
  "requestId": "687b3df76a8d56c94ab32100",
  "status": "PENDING",
  "poll_url": "/v2/external/narrative/status?request_id=687b3df76a8d56c94ab32100",
  "prompt": "A grounded short film about a night market waking before dawn.",
  "duration": 45,
  "inference_model": "gemini-4-argon",
  "created_at": "2026-07-18T10:00:00.000Z",
  "updated_at": "2026-07-18T10:00:00.000Z"
}
```

Persist `request_id` immediately. `poll_url` is a relative canonical path.

## Poll the request

```bash
curl "https://api.samsar.one/v2/external/narrative/status?request_id=687b3df76a8d56c94ab32100" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

The canonical status route accepts `request_id`, `requestId`, or `id` as the query parameter. These path-based aliases are also available:

- `GET /v2/external/narrative/create_single/status?request_id=...`
- `GET /v2/external/narrative/{request_id}/status`
- `GET /v2/external/narrative/create_single/{request_id}/status`

Polling returns HTTP `200` for every stored request state:

| Status | Meaning |
| --- | --- |
| `PENDING` | The request is persisted and waiting for a worker. Only one narrative request runs per user, so another accepted request can remain pending until the active request finishes. |
| `PROCESSING` | Prompt generation, validation, or usage settlement is in progress. |
| `COMPLETED` | Terminal success. The three generated artifacts are present. |
| `FAILED` | Terminal failure. Read `error` and `billing` for details. |

Requests can recover from a processor restart, so continue polling a non-terminal request using the same `request_id`.

## Completed response

The generated objects below are abbreviated; their contents depend on the prompt, duration, and selected model.

```json
{
  "request_id": "687b3df76a8d56c94ab32100",
  "requestId": "687b3df76a8d56c94ab32100",
  "status": "COMPLETED",
  "poll_url": "/v2/external/narrative/status?request_id=687b3df76a8d56c94ab32100",
  "prompt": "A grounded short film about a night market waking before dawn.",
  "duration": 45,
  "inference_model": "gemini-4-argon",
  "themeJson": {
    "...": "generated theme fields"
  },
  "movieResourceList": {
    "...": "final enriched movie resource fields"
  },
  "narrativeJson": {
    "...": "validated narrative fields"
  },
  "billing": {
    "credits_charged": 6.3,
    "remaining_credits": 993.7,
    "usage": {
      "inputTokens": 12000,
      "outputTokens": 3500,
      "cachedInputTokens": 0,
      "reasoningTokens": 900
    }
  },
  "creditsCharged": 6.3,
  "remainingCredits": 993.7,
  "completed_at": "2026-07-18T10:00:24.000Z",
  "created_at": "2026-07-18T10:00:00.000Z",
  "updated_at": "2026-07-18T10:00:24.000Z"
}
```

- `themeJson` is the generated theme used by the narrative workflow.
- `narrativeJson` is the validated narrative before final enrichment.
- `movieResourceList` is the final enriched structure and is compatible with the corresponding `VideoSession.movieResourceList` field.
- `movieResourceList` is returned for your application to store or process; this endpoint does not attach it to a `VideoSession`.

## Billing

The status response reports the final customer charge in `creditsCharged` and the remaining balance in `remainingCredits`. Usage includes the work needed to produce the result, including validation, repairs, and retries. The final charge depends on the selected model and amount of content processed.

When billing is available, the polling response also includes:

- `x-credits-charged`
- `x-credits-remaining`

Provider calls completed before a terminal failure remain billable.

Only one narrative request is processed at a time for each user. The service checks for a positive credit balance both when a request is submitted and immediately before its inference begins, so a queued request can fail with `error.status: 402` if its user no longer has positive credits when it reaches the front of the queue.

Once inference begins, the accepted request's exact incurred usage is always settled in full. The final `remaining_credits` value can therefore be negative when actual usage exceeds the balance available at submission time. Add credits before submitting further narrative work.

## Failed response

A failed request is returned by the polling endpoint with HTTP `200` and `status: "FAILED"`:

```json
{
  "request_id": "687b3df76a8d56c94ab32100",
  "status": "FAILED",
  "prompt": "A grounded short film about a night market waking before dawn.",
  "duration": 45,
  "inference_model": "gemini-4-argon",
  "error": {
    "message": "Narrative generation failed.",
    "code": "NARRATIVE_GENERATION_FAILED",
    "status": 500
  },
  "billing": {
    "credits_charged": 1.2,
    "remaining_credits": 998.8,
    "usage": {
      "inputTokens": 2400,
      "outputTokens": 300,
      "cachedInputTokens": 0,
      "reasoningTokens": 100
    }
  },
  "creditsCharged": 1.2,
  "remainingCredits": 998.8,
  "failed_at": "2026-07-18T10:00:12.000Z"
}
```

## Common HTTP errors

- `400` missing or invalid `prompt`, `duration`, `inference_model`, or `request_id`; missing authentication headers.
- `401` invalid or expired credentials.
- `402` insufficient credits or an API-key usage limit was reached.
- `403` the supplied credential type is not supported by this route.
- `404` the authenticated user or narrative request was not found.
- `503` narrative request persistence or billing indexes are temporarily unavailable.

Content moderation, inference, and final validation failures are stored on the asynchronous request. Polling exposes their original status and machine-readable code inside `error`.

## What this endpoint does not do

`create_single` stops after Samsar has built and validated the final narrative resource structure. It does not:

- create or update a `VideoSession`;
- generate or edit images;
- generate speech, sound effects, music, or other audio files;
- generate, assemble, or publish video.

The requested `duration` controls narrative planning only.


<a id="document-75ccdfc65a9eafd59ab27c7a5e3ba0f8"></a>
## Credits API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/credits

# Credits API

**Quick facts**

- Base URL: `https://api.samsar.one/v1`
- Route prefix: `/credits`
- Authentication: `Bearer API key`
- Execution: `Synchronous account and checkout controls`
- Billing: `100 credits = $1 USD`
- Content type: `application/json`

Credits are billed at **1 USD = 100 credits**. Use these endpoints to check remaining credits and to generate a Stripe checkout link that tops up credits through the webhook.

## GET /credits

Fetch the current credit balance and the most recent top-up (if available).

**Sample request**

```bash
curl https://api.samsar.one/v1/credits \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Success response (200)**

```json
{
  "remainingCredits": 4920,
  "lastTopUp": {
    "id": "66e21f9f1f3b0f0001c7a1a2",
    "amountPaidCents": 5000,
    "currency": "USD",
    "paymentType": "one_time",
    "paymentStatus": "paid",
    "billingReason": "one_time",
    "creditsApplied": 5000,
    "paymentDate": "2024-09-12T10:08:11.000Z",
    "stripeInvoiceId": "in_1Pxxx",
    "stripeInvoiceNumber": "B7A2-1",
    "invoicePdfUrl": "https://...",
    "hostedInvoiceUrl": "https://...",
    "receiptUrl": "https://...",
    "receiptAvailable": true,
    "productSummary": "Purchase 5000 credits"
  }
}
```

**Response headers**

- `x-credits-remaining` returns the current balance.

## POST /credits/recharge

Generate a Stripe checkout link to recharge a specific number of credits.

**Request body**

```json
{
  "credits": 2500
}
```

- `credits` is required, positive, and must be an integer.
- Price is calculated as `credits / 100` in USD.
- Use `/payment_status` with `checkoutSessionId` or `paymentIntentId` to poll for completion.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/credits/recharge \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"credits": 2500}'
```

**Success response (200)**

```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "checkoutSessionId": "cs_test_123",
  "paymentIntentId": "pi_123",
  "paymentStatusEndpoint": "/v1/payment_status",
  "credits": 2500,
  "amountUsd": 25,
  "amountCents": 2500,
  "currency": "USD"
}
```

**Common errors**

- `400` invalid or missing `credits`.
- `401` invalid API key.

## POST /enable_autorecharge

Enable or update auto-recharge settings for the API key. If no saved payment method exists, the response includes a Stripe setup URL to complete the enablement flow.

**Request body**

```json
{
  "thresholdCredits": 1000,
  "amountUsd": 50,
  "maxMonthlyUsd": 200,
  "requestSetupSession": true
}
```

- `thresholdCredits` (optional): auto-recharge triggers when credits fall below this value.
- `amountUsd` (optional): charge amount in USD for each auto-recharge (1 USD = 100 credits).
- `maxMonthlyUsd` (optional): cap auto-recharge spend per calendar month. Set to `0` to disable the cap.
- `requestSetupSession` (optional): force a Stripe setup session if no payment method exists.
- You can also send the payload under `input` (e.g. `{ "input": { ... } }`).

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/enable_autorecharge \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "thresholdCredits": 1000,
    "amountUsd": 50,
    "maxMonthlyUsd": 200,
    "requestSetupSession": true
  }'
```

**Success response (200)**

```json
{
  "autoRechargeEnabled": false,
  "autoRechargeAmountUsd": 50,
  "autoRechargeThreshold": 1000,
  "autoRechargeMaxMonthlyUsd": 200,
  "stripeCustomerId": "cus_123",
  "setupSessionUrl": "https://checkout.stripe.com/c/setup/...",
  "setupSessionId": "cs_test_456",
  "setupIntentId": "seti_123",
  "paymentStatusEndpoint": "/v1/payment_status",
  "url": "https://checkout.stripe.com/c/setup/...",
  "hasPaymentMethod": false,
  "autoRechargeRun": null
}
```

**Notes**

- After Stripe setup completes, auto-recharge is enabled via the webhook and will trigger when credits drop below the threshold.
- If `maxMonthlyUsd` is set, auto-recharges are capped to the remaining monthly allowance; charges are skipped once the cap is reached.
- Use `/payment_status` with `setupSessionId` or `setupIntentId` to poll setup completion.

## GET /payment_status

Poll for the status of a Stripe checkout, payment intent, or setup intent created by the credits endpoints.

**Query params**

- `checkoutSessionId` (or `checkout_session_id`): Stripe Checkout Session id.
- `paymentIntentId` (or `payment_intent_id`): Stripe PaymentIntent id.
- `setupIntentId` (or `setup_intent_id`): Stripe SetupIntent id (auto-recharge setup).

**Sample request**

```bash
curl "https://api.samsar.one/v1/payment_status?checkoutSessionId=cs_test_123" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Success response (200)**

```json
{
  "status": "pending",
  "mode": "payment",
  "checkoutSessionId": "cs_test_123",
  "sessionStatus": "open",
  "paymentStatus": "unpaid",
  "paymentIntentId": "pi_123",
  "paymentIntentStatus": "requires_payment_method",
  "amountCents": 2500,
  "currency": "usd"
}
```

**Status values**

- `pending`: still in progress.
- `succeeded`: payment/setup completed.
- `failed`: payment/setup failed or session expired.

**Common errors**

- `400` missing status identifier.
- `403` session/intent does not belong to the requesting API key.
## POST /auto_recharge/threshold

Update the auto-recharge threshold for an account that already has auto-recharge enabled.

**Request body**

```json
{
  "thresholdCredits": 1500
}
```

- `thresholdCredits` is required and must be a non-negative number.
- Auto-recharge must already be enabled, otherwise the endpoint returns a 400 error.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/auto_recharge/threshold \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"thresholdCredits": 1500}'
```

**Success response (200)**

```json
{
  "autoRechargeEnabled": true,
  "autoRechargeThreshold": 1500,
  "autoRechargeAmountUsd": 50,
  "autoRechargeMaxMonthlyUsd": 200
}
```

**Common errors**

- `400` auto-recharge is not enabled (enable via `/enable_autorecharge` or the billing page).


<a id="document-b5ac2b2c012f6ab0495daa4a05d38b3b"></a>
## External Requests API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/external-requests

# External Requests API

**Quick facts**

- Base URL: `https://api.samsar.one`
- Route prefix: `/v2/external`
- Authentication: `Bearer Samsar API key`
- Execution: `Provider-style calls; sync or async by route`
- Billing: `Endpoint-specific; credit headers report usage`
- Content type: `application/json`

Legacy `/external/*` aliases may exist on some deployments, but new integrations should use `/v2/external/*`.

Use this surface through **samsar-js** to call hosted Samsar as a managed provider for chat, images, video and audio. A standalone installation can choose the Samsar adapter alongside supported native providers; its validated configuration and saved model preferences determine runtime order. See the [model matrix](/models) and [deployment adapter guide](/adapters).

This is different from `/external_users/*`. External users track per-customer credits, history, and login state. External requests are one-off provider-style calls authenticated by a Samsar API key.

## Validate a Samsar API key

`GET /v2/external/api_key/validate`

```bash
curl "https://api.samsar.one/v2/external/api_key/validate" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

Success response:

```json
{
  "valid": true,
  "authType": "api_key",
  "email": "admin@example.com",
  "remainingCredits": 12000
}
```

## Provider capabilities

`GET /v2/external/providers/capabilities`

Returns the provider, model, and action capability map used by deployment onboarding.

```bash
curl "https://api.samsar.one/v2/external/providers/capabilities"
```

## Validate deployment providers

`POST /v2/external/providers/validate`

Use this from the local deployment wizard to validate optional provider credentials before enabling model settings. The SDK sends credentials only to the local processor or configured Samsar API host; do not persist provider secrets in client code.

```bash
curl -X POST "https://api.samsar.one/v2/external/providers/validate" \
  -H "Content-Type: application/json" \
  -d '{
    "samsarApiKey": "sk_live_...",
    "openaiApiKey": "sk-...",
    "falApiKey": "fal_...",
    "runwayApiKey": "rw_..."
  }'
```

Success response:

```json
{
  "providers": {
    "samsar": {
      "ok": true,
      "status": "valid",
      "remainingCredits": 12000
    }
  },
  "available": {
    "providers": ["samsar"],
    "models": ["GOOGLE_TTS", "GPTIMAGE2.5", "HAPPYHORSEI2V", "KIMIK3", "LATENT_SYNC", "LYRIA3", "MMAUDIO", "OPENAI_TTS", "QWEN3.8", "RUNWAYML", "VEO3.1I2V", "WAN2.7PRO", "gemini-4-argon", "gpt-6-astra"],
    "actions": ["assistant", "audio", "chat", "image", "lip_sync", "moderation", "sound_effect", "video"]
  }
}
```

## Chat

### External assistant and chat completions

The external assistant endpoints accept OpenAI-compatible chat completion payloads. They are intended for deployed Samsar environments and other integrations that use Samsar as a managed inference provider.

The `/assistant/*` paths below are naming aliases for the same provider-style chat handler. They are separate from the session-bound [`POST /v1/assistant/completion`](/assistant-api#post-assistantcompletion) API.

### Routes

Create a completion with any of these `POST` routes:

- `/v2/external/chat`
- `/v2/external/chat/completions` — preferred for OpenAI-compatible integrations
- `/v2/external/assistant`
- `/v2/external/assistant/completions`

Read queued request status with any of these `GET` routes:

- `/v2/external/chat/status`
- `/v2/external/chat/completions/status`
- `/v2/external/assistant/status`

The same routes are available under `/api/v2/external`. Legacy deployments may also expose the unversioned `/external` prefix. There is no `/v2/external/assistant/completions/status` route; use `/v2/external/assistant/status` or the canonical `/v2/external/chat/status` path.

### Synchronous completion

Polling is opt-in. Without a polling control, the endpoint waits for inference and returns the raw OpenAI-compatible completion with HTTP `200`.

```bash
curl -X POST "https://api.samsar.one/v2/external/chat/completions" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-6-astra",
    "messages": [
      { "role": "user", "content": "Write a launch caption for a travel reel." }
    ],
    "max_tokens": 300
  }'
```

The default server execution timeout is 10 minutes. Omit `stream`, or set it to `false`, for the JSON response shown above. Use [streaming](#streaming-completion) for incremental text or [queued polling](#queued-completion-with-polling) for a durable asynchronous request.

See the [final token prices](/pricing#inference-rates) for input, output, and cached-input credits per one million tokens. The listed route-specific rates apply to both public chat/assistant aliases and session assistants. Production agent pipeline inference retains its flat stage pricing.

Send `Idempotency-Key` or reuse `client_request_id` when retrying the same logical request in JSON, streaming, or queued mode. The SDK request option is `{ idempotencyKey: 'stable-request-id' }`. When both identifiers are supplied, the client request ID takes precedence. Changed payloads under the same key produce a `409` conflict, delivered as an error event if the stream has opened; completed replays reuse the saved response and original debit. A replay's credit receipt describes that original charge, and polling does not create another inference charge.

Requests awaiting billing confirmation or completion after a timeout can remain pending. Continue checking the existing request with the same key. Paid tools may incur separate charges; see [Assistant billing and retries](/assistant-api#billing-and-retries).

When available, billing is returned through these headers:

- `x-credits-charged`
- `x-credits-remaining`

### Streaming completion

Set `stream: true` on the same completion route, without polling controls. The response uses **Samsar named Server-Sent Events**, not OpenAI's `data: [DONE]` or chat-completion-delta format.

```bash
curl -N -X POST "https://api.samsar.one/v2/external/chat/completions" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: travel-caption-001" \
  -d '{"model":"gpt-6-astra","messages":[{"role":"user","content":"Write a launch caption for a travel reel."}],"stream":true}'
```

| Event | Meaning |
| --- | --- |
| `request` | Contains `requestId` and the effective `idempotencyKey`. Save the key for reconnection. |
| `snapshot` | Contains accumulated `text` and available progress metadata. Replace the displayed text; do not append the whole snapshot. |
| `completed` | Contains the final `response`, `creditsCharged`, and `remainingCredits` after settlement. |
| `error` | Contains `code` and `message`, with `requestId` and `status` when available. Partial text is not a completed, settled response. |

Reconnect by repeating the POST with the same logical payload and request key. A disconnect does not cancel provider work or settlement. Replays reuse the existing request; switching `stream` off can retrieve its JSON result without another completed-request debit. Errors after the stream opens arrive as events, so HTTP `200` alone does not indicate success. Read the final credit receipt from `completed`, rather than expecting response headers to change after streaming starts.

Streaming and queued polling are separate modes. Combining `stream: true` with `async`, `poll`, or a polling `response_mode` is rejected.

### Queued completion with polling

Use polling for long-running assistant work such as narrative or theme generation. It avoids holding one HTTP connection open for the entire model call and allows the request to recover after a client disconnect, network reset, or processor restart.

Generate and persist a stable `client_request_id` before submitting. Retry the same logical submission with the same ID if the initial response is lost.

The default polling-record lifetime is 24 hours. Requests still awaiting completion can remain pending beyond that period. Retrying with a new key creates a new submission; keep the original key for retries.

```bash
curl -X POST "https://api.samsar.one/v2/external/assistant/completions" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-6-astra",
    "messages": [
      { "role": "user", "content": "Create a cinematic theme for this video." }
    ],
    "response_mode": "polling",
    "client_request_id": "video-67df0d8e:theme:v1",
    "client_session_id": "video-67df0d8e",
    "client_request_key": "theme"
  }'
```

`async: true`, `poll: true`, or `response_mode: "async" | "poll" | "polling"` all enable queued mode. Prefer `response_mode: "polling"` for new integrations.

The canonical fields are:

| Field | Purpose |
| --- | --- |
| `client_request_id` | Optional idempotency key. Make it unique for one logical request and reuse it only when retrying that request. |
| `client_session_id` | Optional local session correlation value. It is persisted and echoed only when `client_request_id` is present. |
| `client_request_key` | Optional local stage or operation name, such as `theme` or `narrative`. It is persisted and echoed only when `client_request_id` is present. |
| `timeout` / `timeoutMs` | Optional server execution timeout in milliseconds. The default is `600000` (10 minutes). |

A queued request returns HTTP `202`:

```json
{
  "request_id": "67df0d8ebc4f9d0b7f4fd123",
  "requestId": "67df0d8ebc4f9d0b7f4fd123",
  "status": "PENDING",
  "poll_url": "/v2/external/chat/status?request_id=67df0d8ebc4f9d0b7f4fd123",
  "client_request_id": "video-67df0d8e:theme:v1",
  "client_session_id": "video-67df0d8e",
  "client_request_key": "theme",
  "created_at": "2026-07-16T13:00:00.000Z",
  "updated_at": "2026-07-16T13:00:00.000Z"
}
```

`poll_url` is a relative canonical path. Store `request_id` as soon as it is returned. If the submit response is lost, you can still look up the request by the persisted `client_request_id`.

Poll by provider request ID:

```bash
curl "https://api.samsar.one/v2/external/chat/status?request_id=67df0d8ebc4f9d0b7f4fd123" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

Or recover by client request ID:

```bash
curl "https://api.samsar.one/v2/external/chat/status?client_request_id=video-67df0d8e%3Atheme%3Av1" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

Status reads are immediate rather than long-polling. Poll every 1–2 seconds until the request reaches a terminal state:

| Status | Meaning |
| --- | --- |
| `PENDING` | Persisted and waiting to be claimed. Polling also repairs a request persisted immediately before a processor restart. |
| `PROCESSING` | Claimed by the hosted processor. An expired worker lease can be reclaimed safely. |
| `COMPLETED` | Terminal success. Read the OpenAI-compatible completion from `response`. |
| `FAILED` | Terminal failure. Read the provider-safe details from `error`. |

Completed status response:

```json
{
  "request_id": "67df0d8ebc4f9d0b7f4fd123",
  "status": "COMPLETED",
  "response": {
    "id": "chatcmpl_123",
    "object": "chat.completion",
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "content": "A precise cinematic theme..."
        },
        "finish_reason": "stop"
      }
    ]
  },
  "creditsCharged": 12,
  "remainingCredits": 9988
}
```

Failed status response (HTTP `200`):

```json
{
  "request_id": "67df0d8ebc4f9d0b7f4fd123",
  "status": "FAILED",
  "error": {
    "message": "External assistant request failed.",
    "code": null,
    "status": 500
  }
}
```

Idempotent submission replays return the original request and do not replace its payload. Use a new `client_request_id` only for an intentional new submission; unresolved requests must retain their original key. Fetch status to obtain completion credit headers and body fields, including after a replay.

Common errors:

- `400` missing authentication headers, missing or invalid `messages`, streaming combined with polling controls, or an invalid status lookup ID.
- `401` invalid or expired credentials.
- `402` insufficient credits for a synchronous request.
- `403` the supplied credential type is not supported by this provider route.
- `404` request not found for the authenticated account.
- Async provider failures are represented by HTTP `200` with `status: "FAILED"` and the nested `error` object.

## Embeddings

`POST /v2/external/embeddings`

Create OpenAI-compatible embedding vectors with `text-embedding-3-small` at 1536 dimensions. Send one string or up to 100 strings; each input may contain up to 12,000 characters. Billing is **100 credits per 1M tokens**.

```bash
curl -X POST "https://api.samsar.one/v2/external/embeddings" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": ["A launch-ready product description", "A concise campaign tagline"],
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }'
```

## Image

`/v2/external/image` mounts the canonical Image API behind external-provider authentication. The request bodies, status behavior, and pricing are unchanged; add `/v2/external` before the documented `/image/...` path.

| Route | Purpose and billing |
| --- | --- |
| `POST /v2/external/image/text_to_image` | Generate images at the selected model rates, charged on completion. `/generate` and `/generations` are compatibility aliases. |
| `POST /v2/external/image/assign_title` | Generate an image title; the response credit receipt reports the final usage-based charge. |
| `POST /v2/external/image/enhance` | Enhance to the selected resolution; the completed image-model call determines the final charge. |
| `POST /v2/external/image/remove_branding` | Remove brand text at the selected image-edit model rates, charged on completion. |
| `POST /v2/external/image/add_image_set` | Extend an image set at the selected model rates, charged on completion. |
| `GET /v2/external/image/status` | Poll an asynchronous hosted image request. |

The mounted surface also includes image history, receipt-template, receipt-query, and rollup-banner routes. Use the [Image API](/image-api) as the canonical contract and rate reference for those paths.

Example:

```bash
curl -X POST "https://api.samsar.one/v2/external/image/enhance" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://cdn.example.com/photo.png",
    "resolution": "1k"
  }'
```

Async image routes return a `request_id`. Poll:

```bash
curl "https://api.samsar.one/v2/external/image/status?request_id=img_enh_123" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

## Video

`POST /v2/external/video/{video_route}`

The external video surface combines the canonical Video API with standalone provider-first routes for remote deployments that bill through a Samsar API key. Add `/v2/external` before a documented `/video/...` path to use the mounted canonical surface; the table below highlights the provider-first additions.

| Route | Purpose |
| --- | --- |
| `POST /v2/external/video/text_to_video` | Create an express text-to-video request. |
| `POST /v2/external/video/image_to_video` | Animate one public image directly; alias of the direct image-to-video handler. |
| `POST /v2/external/video/direct_text_to_video` | Generate a clip directly from a prompt with a supported text-to-video model. |
| `POST /v2/external/video/direct_image_to_video` | Animate one public image directly, without image generation or the full express narrative pipeline. |
| `POST /v2/external/video/narrative_to_video` | Render a completed singular or branched NarrativeRequest without rerunning prompt generation. |
| `POST /v2/external/video/text_to_interactive_video` | Build and render a branching interactive-video workflow from text. |
| `POST /v2/external/video/lip_sync` | Create a lip-sync video-to-video request from public `video_url` and `audio_url` inputs. |
| `POST /v2/external/video/sound_effect` | Create a sound-effect video-to-video request from a public `video_url` input and prompt. |
| `GET /v2/external/video/status` | Poll by `request_id` or `session_id`. |
| `GET /v2/external/video/{request_id}/status` | Path-param status polling alias. |
| `GET /v2/external/video/status_detailed` | Poll detailed status plus normalized video preview data. |
| `GET /v2/external/video/{request_id}/status_detailed` | Path-param detailed status polling alias. |

### Final AI-video model-call prices

Studio, rerolls and direct hosted model calls settle on completion. The following final customer prices apply to the named native adapter and configuration; per-second units refer to generated output before scene trimming or padding.

| Model | Adapter | Configuration | Unit | Credits |
| --- | --- | --- | --- | --- |
| `RUNWAYML` | Runway | Gen-4.5 | second | 14.4 |
| `VEO3.1 / VEO3.1I2V` | Google Cloud | 720p / 1080p, video | second | 24 |
| `VEO3.1 / VEO3.1I2V` | Google Cloud | 720p / 1080p, video + audio | second | 48 |
| `VEO3.1FAST / VEO3.1I2VFAST` | Google Cloud | 720p, video | second | 9.6 |
| `VEO3.1FAST / VEO3.1I2VFAST` | Google Cloud | 720p, video + audio | second | 12 |
| `VEO3.1FAST / VEO3.1I2VFAST` | Google Cloud | 1080p, video | second | 12 |
| `VEO3.1FAST / VEO3.1I2VFAST` | Google Cloud | 1080p, video + audio | second | 14.4 |
| `HAPPYHORSEI2V` | Alibaba international | Happy Horse 1.1, 720p | second | 16.8 |
| `HAPPYHORSEI2V` | Alibaba China / global | Happy Horse 1.1, 720p | second | 14.85228 |
| `HAILUOPRO` | MiniMax | Hailuo 02, 768p, 6 seconds | clip | 33.6 |
| `HAILUOPRO` | MiniMax | Hailuo 02, 768p, 10 seconds | clip | 67.2 |

When a hosted direct Fal AI-video route is enabled, these checked-in model rates apply. A rate entry does not enable a model in every deployment:

| Model key | Configuration | Final hosted charge |
| --- | --- | --- |
| [`SDVIDEO`](https://fal.ai/models/fal-ai/stable-video) | Stable Video | 9 credits / video |
| [`SKYREELSI2V`](https://fal.ai/models/fal-ai/skyreels-i2v) | SkyReels I2V | 36 credits / video |
| [`VIDUI2V`](https://fal.ai/models/fal-ai/vidu/image-to-video) | Vidu I2V, 4 seconds | 24 credits / video |
| [`WANI2V5B`](https://fal.ai/models/fal-ai/wan/v2.2-5b/image-to-video) | Wan 2.2 5B, 81 frames | 18 credits / video |
| [`WANI2V`](https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video) | Wan 2.2 A14B, 16 fps | 48.6 credits / 81 frames; 72.6 credits / 121 frames |
| [`COSMOS3SUPERI2V`](https://fal.ai/models/nvidia/cosmos-3-super/image-to-video) | Cosmos 3 Super | 6 credits / rounded second |
| [`KLINGTXTTOVIDSTANDARD / KLINGIMGTOVIDSTANDARD / KLINGIMGTOVIDPRO`](https://fal.ai/models/fal-ai/kling-video/v1.6/standard/image-to-video) | Kling 1.6 standard; the current image PRO alias uses the standard endpoint | 6.72 credits / second |
| [`KLINGTXTTOVIDPRO`](https://fal.ai/models/fal-ai/kling-video/v1.6/pro/text-to-video) | Kling 1.6 pro, text to video | 11.76 credits / second |
| [`KLINGIMGTOVIDPROMASTER / KLINGIMGTOVID2.1MASTER`](https://fal.ai/models/fal-ai/kling-video/v2.1/master/image-to-video) | Kling 2 master / 2.1 master | 33.6 credits / second |
| [`KLINGIMGTOVID2.1STANDARD`](https://fal.ai/models/fal-ai/kling-video/v2.1/standard/image-to-video) | Kling 2.1 standard | 6.72 credits / second |
| [`KLINGIMGTOVID2.1PRO`](https://fal.ai/models/fal-ai/kling-video/v2.1/pro/image-to-video) | Kling 2.1 pro | 11.76 credits / second |
| [`KLINGIMGTOVID4 / KLINGTXTTOVID4`](https://fal.ai/models/kling/v4/image-to-video) | Kling 4, 720p; 5–30 seconds in 5-second steps | 18.84 credits / second |
| [`VEO / VEOI2V`](https://fal.ai/models/fal-ai/veo2/image-to-video) | Veo 2 | 60 credits / second |
| [`VEO3.1 / VEO3.1I2V / VEO3.1FLIV`](https://fal.ai/models/fal-ai/veo3.1/image-to-video) | Veo 3.1 standard, audio off / on | 24 / 48 credits per second |
| [`VEO3.1FAST / VEO3.1I2VFAST`](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video) | Veo 3.1 fast, audio off / on | 12 / 18 credits per second |
| [`HAPPYHORSEI2V`](https://fal.ai/models/alibaba/happy-horse/v1.1/image-to-video) | Happy Horse 1.1, 720p | 16.8 credits / second |
| [`HAILUOPRO`](https://fal.ai/models/fal-ai/minimax/hailuo-02/pro/image-to-video) | Hailuo 02 pro | 9.6 credits / second |
| [`PIXVERSEI2V`](https://fal.ai/models/fal-ai/pixverse/v4.5/image-to-video) | PixVerse 4.5 normal, 720p, 5 / 8 seconds | 24 / 48 credits per video |
| [`PIXVERSEI2VFAST`](https://fal.ai/models/fal-ai/pixverse/v4.5/image-to-video/fast) | PixVerse 4.5 fast, 720p, 5 / 8 seconds | 48 / 96 credits per video |
| [`PIKA2.2I2V`](https://fal.ai/models/fal-ai/pika/v2.2/image-to-video) | Pika 2.2, 720p, 5 seconds | 24 credits / video |
| [`SEEDANCEI2V`](https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/image-to-video) | Seedance 1.5 pro, audio off / on | 144 / 288 credits per million video tokens |
| [`SEEDANCE2.0I2V`](https://fal.ai/models/bytedance/seedance-2.0/image-to-video) | Seedance 2.0 | 1.68 credits per thousand video tokens |
| [`SEEDANCE2.5I2V`](https://fal.ai/models/bytedance/seedance-2.5/image-to-video) | Seedance 2.5 | 2.568 credits per thousand video tokens |

Per-second rates use the submitted configuration; Seedance video-token rates use measured completed output. The worker saves the tariff before submission. Hosted direct Fal paths without verified tariffs stop before a paid call: this includes Haiper 2.0, Magi Distilled, 10-second Pika 2.2, 121-frame Wan 2.2 5B, and PixVerse durations other than five or eight seconds.

Fal-backed hosted lip-sync calls use these final customer rates:

| Model | Final hosted charge |
| --- | --- |
| [`SYNCLIPSYNC`](https://fal.ai/models/fal-ai/sync-lipsync/v3) | 16 credits / measured output second |
| [`LATENTSYNC`](https://fal.ai/models/fal-ai/latentsync) | 24 credits / video through 40 seconds; 0.6 credits / output second above 40 seconds |
| [`KLINGLIPSYNC`](https://fal.ai/models/fal-ai/kling-video/lipsync/audio-to-video) | 1.68 credits / billable input-video second; 5-second blocks |
| [`CREATIFYLIPSYNC`](https://fal.ai/models/creatify/lipsync) | 2 credits / measured output second |
| [`HUMMINGBIRDLIPSYNC`](https://fal.ai/models/fal-ai/tavus/hummingbird-lipsync/v0) | 15 credits / requested second (historical fallback) |

LatentSync's above-40-second rate applies to its full output duration. Hummingbird retains a historical application rate; its current provider tariff has not been verified. Each completion receipt uses the billing unit shown in the table.

Fal-backed hosted video sound-effect calls use these final rates:

| Model | Final hosted charge | Configuration |
| --- | --- | --- |
| [`MMAUDIOV2`](https://fal.ai/models/fal-ai/mmaudio-v2) | 0.12 credits / submitted audio second | 8 seconds when duration is omitted |
| [`MIRELOAI`](https://fal.ai/models/mirelo-ai/sfx1.6/video-to-video) | 1.2 credits / submitted second / sample | 1 sample for new calls; older calls may have 2 samples |

Charges use submitted duration and sample count. Mirelo's sample multiplier is an application billing assumption and has not been invoice-verified. GMICloud routes report their own configuration-specific charges in completion receipts. Keep the same request key while billing confirmation is pending.

Full production agent workflows, including `text_to_video` and narrative rendering, retain their [fixed video prices](/pricing#video-models). A standalone deployment waives local debits when calling hosted Samsar; the hosted call receives one charge. Audio-only sound effects use the [audio prices](#audio).

### Video status and delivery

`status` and `status_detailed` also accept `POST` with `request_id` or `session_id` in the JSON body.

Hosted `SEEDANCE2.5I2V` requests use the validated GMICloud model `seedance-2-5-260628` for both the text-to-video agent's scene animation and direct external image-to-video handling. Hosted routing does not fall back to Fal, and one logical layer request is dispatched to one adapter only.

On terminal video failure, both status routes return the exact stored provider or model message instead of replacing it with a generic pipeline error. Compact status exposes it through `generationError`, `expressGenerationError`, `error`, and `message`. Detailed status also retains the failed asset's error under `session.layers`, such as `aiVideoGenerationError`, `imageSession.generationError`, `lipSyncVideoGenerationError`, or `soundEffectVideoGenerationError`.

Session listing, translation, joining, subtitle, reroll, clone, outro/footer, and render-control paths from the [Video API](/video) are also available through this mounted prefix.

For `lip_sync` and `sound_effect`, media inputs must be publicly reachable HTTP(S) URLs. Raw bytes, base64/data URLs, local filesystem paths, localhost URLs, and private network URLs are rejected. Docker deployments should publish local media through configured S3-compatible storage, CloudFront, or another signed/public URL strategy before calling these hosted external routes.

Example:

```bash
curl -X POST "https://api.samsar.one/v2/external/video/text_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "A cinematic product launch reel",
      "image_model": "GPTIMAGE2.5",
      "video_model": "RUNWAYML",
      "duration": 10,
      "aspect_ratio": "9:16",
      "inference_model": "gpt-6-astra"
    },
    "webhookUrl": "https://example.com/webhook"
  }'
```

Image-to-video example:

```bash
curl -X POST "https://api.samsar.one/v2/external/video/image_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "image_url": "https://cdn.example.com/scene-1.png",
      "prompt": "A polished destination reel",
      "video_model": "RUNWAYML",
      "aspect_ratio": "16:9"
    }
  }'
```

Narrative-to-video example:

```bash
curl -X POST "https://api.samsar.one/v2/external/video/narrative_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "narrative_request_id": "687b4127b503e2b4acdf9876"
    }
  }'
```

The source can be singular or branched. For a branched source, polling returns a normalized `branching` manifest with one path per leaf, choice-point metadata, path-specific frame/video state, and aggregate progress. The compact status response avoids raw frame data; `status_detailed` adds path timelines that reference each shared layer and audio asset by ID for client-side preview.

The request reaches top-level `COMPLETED` only after every leaf video has rendered. The terminal manifest exposes the complete `branching.outputs.paths` URL mapping, while compatibility fields keep `result_url` as the default path, return every leaf in ordered `result_urls`, and retain `branch_results`. See [Render a narrative as video](/narrative/render-video) for the full lifecycle, normalized response, and interactive switching flow.

Lip-sync example:

```bash
curl -X POST "https://api.samsar.one/v2/external/video/lip_sync" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "video_url": "https://cdn.example.com/clip.mp4",
      "audio_url": "https://cdn.example.com/dialogue.wav",
      "lip_sync_model": "SYNCLIPSYNC",
      "duration": 8,
      "prompt": "Match the speaker performance to the supplied audio."
    }
  }'
```

Sound-effect example:

```bash
curl -X POST "https://api.samsar.one/v2/external/video/sound_effect" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "video_url": "https://cdn.example.com/clip.mp4",
      "prompt": "Soft ocean waves and distant city ambience",
      "sound_effect_model": "MIRELOAI",
      "duration": 8
    }
  }'
```

Poll:

```bash
curl "https://api.samsar.one/v2/external/video/status?request_id=66ff..." \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

Detailed status:

```bash
curl "https://api.samsar.one/v2/external/video/status_detailed?request_id=66ff..." \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

For branched video sessions, read `branching.summary` to display progress and `branching.paths` to display each leaf render. In detailed status, build maps of `session.layers` and `session.audioLayers` by `id`, then resolve each selected path's `timeline[].layer_id` and `audio_timeline[].audio_layer_id` references to preview its current assets. At a `branching.tree.choice_points[].switch_at_seconds` boundary, the selected option's `leaf_path_ids` narrows the candidate final videos; `selection_trail` provides the exact ordered choices for each leaf.

## Audio

Hosted audio is asynchronous. Submit one of the canonical routes below, persist the returned `request_id`, then poll `/v2/external/audio/status`.

| Route | Model/provider values | Price |
| --- | --- | ---: |
| `POST /v2/external/audio/text_to_speech` | `OPENAI`, `ELEVENLABS`, `GOOGLE`, `PLAYAI` | 1 credit/request |
| `POST /v2/external/audio/text_to_music` | `ELEVENLABS_MUSIC`, `LYRIA3` | 2 credits/request |
| `POST /v2/external/audio/text_to_sound_effect` | `SDAUDIO` and configured aliases | 1 credit/request |
| `POST /v2/external/audio/transcript_align` | OpenAI `whisper-1` | Usage based; 0.9 credits/min by default |

```bash
curl -X POST "https://api.samsar.one/v2/external/audio/text_to_music" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "Warm cinematic synth backing track, instrumental only",
      "model": "ELEVENLABS_MUSIC",
      "duration": 30,
      "is_instrumental": true
    }
  }'
```

Poll:

```bash
curl "https://api.samsar.one/v2/external/audio/status?request_id=66ff..." \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

## samsar-js

```ts

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY! });

await samsar.validateV2ExternalSamsarApiKey();

const chat = await samsar.createV2ExternalChatCompletion({
  model: 'gpt-6-astra',
  messages: [{ role: 'user', content: 'Write a concise product caption.' }],
});

const video = await samsar.createV2ExternalVideoRequestFromText({
  prompt: 'A cinematic product launch reel',
  image_model: 'GPTIMAGE2.5',
  video_model: 'RUNWAYML',
  duration: 10,
});

const status = await samsar.getV2ExternalVideoStatus(video.data.request_id!);

const imageVideo = await samsar.createV2ExternalVideoRequestFromImage({
  image_url: 'https://cdn.example.com/scene-1.png',
  video_model: 'RUNWAYML',
});

const lipSync = await samsar.createV2ExternalLipSyncVideo({
  video_url: 'https://cdn.example.com/clip.mp4',
  audio_url: 'https://cdn.example.com/dialogue.wav',
  lip_sync_model: 'SYNCLIPSYNC',
});

const soundEffect = await samsar.createV2ExternalSoundEffectVideo({
  video_url: 'https://cdn.example.com/clip.mp4',
  prompt: 'Soft ocean waves and distant city ambience',
  sound_effect_model: 'MIRELOAI',
});

const detailed = await samsar.getV2ExternalVideoStatusDetailed(lipSync.data.request_id!);

await samsar.requestV2ExternalImage('enhance', {
  image_url: 'https://cdn.example.com/photo.png',
  resolution: '1k',
});

const music = await samsar.createV2ExternalTextToMusicAudio({
  prompt: 'Warm cinematic synth backing track, instrumental only',
  model: 'ELEVENLABS_MUSIC',
  duration: 30,
  is_instrumental: true,
});

const audioStatus = await samsar.getV2ExternalAudioStatus(music.data.request_id!);
```

The shorter aliases also use the v2 external routes:

- `validateSamsarApiKey`
- `getExternalProviderCapabilities`
- `validateDeploymentProviders`
- `createExternalChat`
- `createExternalChatCompletion`
- `requestExternalImage`
- `requestExternalVideo`
- `createExternalVideoRequestFromText`
- `createExternalVideoRequestFromImageList`
- `createExternalVideoRequestFromImage`
- `createExternalLipSyncVideo`
- `createExternalSoundEffectVideo`
- `getExternalImageStatus`
- `getExternalVideoStatus`
- `getExternalVideoStatusDetailed`
- `getExternalVideoDetailedStatus`
- `requestExternalAudio`
- `requestExternalAudioRoute`
- `createExternalTextToMusicAudio`
- `getExternalAudioStatus`

Direct video model calls, lip-sync and sound-effect layers are charged on completion at the [final output prices](/pricing#video-model-calls). Reuse `Idempotency-Key` for submission retries; a changed payload returns `409`, and completed replays retain their original charge. Billing confirmation can remain pending after generation. The full production agent workflow keeps its fixed pricing.


<a id="document-3a636b8a5cd6477b15ade86d88f4fb0a"></a>
## External Users API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/external-users

# External Users API

**Quick facts**

- Base URL: `https://api.samsar.one/v1`
- Route prefix: `/external_users`
- Authentication: `Platform key, scoped external key, or exchanged client token`
- Execution: `Synchronous controls plus asynchronous generation`
- Billing: `Credits, refunds, history, and purchases scoped per external user`
- Content type: `application/json`

Use this surface when many users share one central Samsar account, but each external user still needs their own credits, request history, payments, publishing controls, and login session.

## External user identity

Most external endpoints accept an `external_user` object:

```json
{
  "external_user": {
    "provider": "whop",
    "unique_key": "whop:usr_123",
    "external_user_id": "usr_123",
    "external_app_id": "app_abc",
    "external_company_id": "biz_456",
    "email": "member@example.com",
    "username": "member_handle",
    "display_name": "Member Name",
    "metadata": {
      "membership_id": "mem_123"
    }
  }
}
```

Required fields:

- `provider`
- `external_user_id`

Optional stable reference:

- `unique_key`: a globally unique reference for the external user, such as a wallet address, email address, or platform user key. If omitted, Samsar stores `external_user_id` as the `unique_key`.

Recommended for multi-app providers:

- `external_app_id`
- `external_company_id`

The first successful bootstrap request upserts an `ExternalUser` record mapped to the owning Samsar account internally. The stored record keeps both the owning internal user id and the external user's `unique_key`.

Established identities retain the owning account, any customer sub-account ownership, and the billing user type set at creation. Profile updates cannot change these fields; identity conflicts across owners return `403`. Metadata, including `metadata.billingMode`, cannot select or switch the billing source.

For V2 clients that only need to register and reference an external user by a single key, use `POST /v2/user/create_external_user` with an internal API key, user auth token, or APP_KEY:

```bash
curl -X POST https://api.samsar.one/v2/user/create_external_user \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "unique_key": "wallet:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "email": "member@example.com",
    "display_name": "Member Name"
  }'
```

The response includes `external_user.unique_key` and a `reference` object. Future V2 calls can pass that `unique_key` to resolve the external user.

## Auth model

There are two supported auth patterns for ordinary external-user operations. Manual credit grants are restricted to signed-in administrators; see [manual credit grants](#post-external_userscreditsgrant).

### 1. Server-to-server platform flow

1. Your backend calls `POST /external_users/session` with the shared platform API key plus an `external_user` object.
2. Samsar upserts the external user and returns an `external_api_key`.
3. Subsequent external-user scoped requests include:
   - `Authorization: Bearer <PLATFORM_API_KEY>`
   - `x-external-user-api-key: <EXTERNAL_USER_API_KEY>`

### 2. Client login flow

1. Your backend calls `POST /external_users/create_login_token`.
2. Samsar returns a short-lived `loginToken` and a ready-to-open `loginUrl`.
3. The client exchanges that `loginToken` through `GET /users/verify_token?loginToken=...`.
4. The response contains a long-lived `authToken`.
5. The client can call `/v1/external_users/*` routes with:
   - `Authorization: Bearer <EXTERNAL_AUTH_TOKEN>`

The platform API key should stay server-side. Only the external auth token should reach the browser.

## Response conventions

External generation endpoints return external request ids:

```json
{
  "request_id": "extreq_...",
  "session_id": "extreq_...",
  "external_request_id": "extreq_...",
  "external_session_id": "extreq_...",
  "upstream_request_id": "66ff...",
  "upstream_session_id": "66ff...",
  "status_endpoint": "/v1/external_users/status?request_id=extreq_..."
}
```

- `request_id` / `session_id` are the external ids you should store client-side.
- `upstream_request_id` / `upstream_session_id` are the internal Samsar session ids.
- Poll `GET /external_users/status` with the external request id.

## POST /external_users/session

Create or refresh an external-user session and receive that user’s dedicated API key plus current credits.

```bash
curl -X POST https://api.samsar.one/v1/external_users/session \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "external_user": {
      "provider": "whop",
      "unique_key": "whop:usr_123",
      "external_user_id": "usr_123",
      "external_app_id": "app_abc"
    }
  }'
```

Success response:

```json
{
  "external_api_key": "sxu_********************************",
  "remainingCredits": 1000,
  "external_user": {
    "provider": "whop",
    "unique_key": "whop:usr_123",
    "external_user_id": "usr_123",
    "generation_credits": 1000,
    "has_external_api_key": true
  }
}
```

## POST /external_users/create_login_token

Create a short-lived external-user login token and a ready-to-open client login URL.

```bash
curl -X POST https://api.samsar.one/v1/external_users/create_login_token \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "redirect": "/external/studio"
  }'
```

Success response:

```json
{
  "loginToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresInSeconds": 600,
  "expiresAt": "2026-03-21T12:00:00.000Z",
  "loginUrl": "https://app.samsar.one/verify?loginToken=...&redirect=%2Fexternal%2Fstudio",
  "external_user": {
    "provider": "whop",
    "external_user_id": "usr_123"
  }
}
```

## GET /users/verify_token

Exchange the external `loginToken` for a long-lived external `authToken`.

```bash
curl "https://api.samsar.one/users/verify_token?loginToken=LOGIN_TOKEN_****************"
```

Success response:

```json
{
  "_id": "69bbb64111f47422c1083360",
  "authToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "isExternalUser": true,
  "provider": "whop",
  "externalUserId": "user_46cF7yVLkPms5",
  "externalAppId": "app_8jnV5WOvSLgyLr",
  "generationCredits": 3000
}
```

Once you have this `authToken`, call external-user routes with:

```bash
-H "Authorization: Bearer EXTERNAL_AUTH_TOKEN_****************"
```

## POST /external_users/assistant/set_system_prompt

Store or clear an assistant system prompt for one external user. This prompt is applied to that external user’s future assistant requests and overrides the owning account prompt for that external user only.

```bash
curl -X POST https://api.samsar.one/v1/external_users/assistant/set_system_prompt \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "system_prompt": "You are the storefront assistant for this creator. Keep answers concise, visually aware, and commercially practical."
  }'
```

Success response:

```json
{
  "system_prompt": "You are the storefront assistant for this creator. Keep answers concise, visually aware, and commercially practical.",
  "model": "gpt-6-astra",
  "selected_assistant_model": "gpt-6-astra",
  "external_user": {
    "provider": "whop",
    "external_user_id": "usr_123"
  }
}
```

Pass `null` or an empty string to clear the external-user-specific prompt and fall back to the owning account prompt or Samsar’s minimal default prompt.

## POST /external_users/assistant/completion

Create a synchronous assistant response for an external user using the owning Samsar account's configured assistant model. Standard external users pay from their allocated external balance. Internal-mapped external users debit the owning internal account; a configured customer sub-account budget is also consumed once as a spending limit, without a second debit to the internal balance.

- `session_id` is required.
- You can send the external request/session id returned by external generation routes, or the upstream internal session id.
- Request and response format match the standard Assistant API, including multimodal input and image-generation tool calls.
- Pricing follows the final input, output, and cached-input token rates for the selected model and adapter. Use an `Idempotency-Key` header for retries.
- Reusing the same key and payload returns the original response and charge without another debit; changed payloads return `409`.
- Paid tools may incur separate charges. Requests awaiting billing confirmation or completion after a timeout can remain pending; reuse the same request key. See [Assistant billing and retries](/assistant-api#billing-and-retries).

```bash
curl -X POST https://api.samsar.one/v1/external_users/assistant/completion \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "extreq_123",
    "input": "Write a product caption for this video and suggest a headline.",
    "max_output_tokens": 250
  }'
```

Success response:

```json
{
  "id": "resp_123",
  "object": "response",
  "created_at": 1773651000,
  "status": "completed",
  "model": "gpt-6-astra",
  "output_text": "Built to move fast: bold design, clean energy, and a launch-ready look in one line.",
  "output": [
    {
      "id": "resp_123_message",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Built to move fast: bold design, clean energy, and a launch-ready look in one line.",
          "annotations": []
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 482,
    "output_tokens": 43,
    "total_tokens": 525
  }
}
```

Response headers:

- `x-credits-charged`
- `x-credits-remaining`

## POST /external_users/generate_embeddings_from_plain_text

Create embeddings for one external user from already cleaned plain text. This route skips crawling entirely and uses the same compatible embedding template format as the main chat embedding endpoints.

- Request body accepts the same cleaned text shapes as `/chat/generate_embeddings_from_plain_text`.
- External-user credits are charged on the external balance only.
- Embedding input costs **250 credits per 1M tokens**, with no crawl charge.

```bash
curl -X POST https://api.samsar.one/v1/external_users/generate_embeddings_from_plain_text \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "name": "product-docs-clean",
      "plain_text": [
        {
          "url": "https://example.com/docs/getting-started",
          "title": "Getting Started",
          "content": "Cleaned plain text content from the page."
        }
      ]
    }
  }'
```

Success response:

```json
{
  "template_id": "66f3b0d64c8bca9c6f2bd1a3",
  "template_hash": "b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "hash_link": "embedding_template:b0e6f2d2c2f1d0c4d9f7f3a1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
  "record_count": 1,
  "structured_fields": [
    { "key": "hostname", "type": "string" }
  ],
  "unstructured_fields": ["title", "content"],
  "external_user": {
    "provider": "whop",
    "external_user_id": "usr_123",
    "generation_credits": 980
  }
}
```

Response headers:

- `x-credits-charged`
- `x-credits-remaining`

## POST /external_users/text_to_video

Create a text-to-video request attributed to an external user.

```bash
curl -X POST https://api.samsar.one/v1/external_users/text_to_video \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "external_user": {
      "provider": "whop",
      "external_user_id": "usr_123",
      "external_app_id": "app_abc"
    },
    "input": {
      "prompt": "A cinematic teaser for a new sneaker drop",
      "image_model": "GPTIMAGE2.5",
      "video_model": "RUNWAYML",
      "duration": 10,
      "tone": "grounded",
      "aspect_ratio": "16:9",
      "language": "en",
      "enable_subtitles": true,
      "font_key": "Poppins",
      "generate_outro_image": true,
      "cta_url": "https://example.com/drop",
      "cta_text_top": "Scan to shop",
      "cta_text_bottom": "Limited release",
      "add_footer_animation": true,
      "footer_metadata": [
        { "url": "https://example.com/drop", "title": "Shop the drop" }
      ]
    }
  }'
```

`input` uses the same fields, current model keys, and validation rules as [`POST /video/text_to_video`](/video#post-videotext_to_video). The external-user route adds scoped identity and billing: credits are reserved from that external user's balance after validation, then unused credits are refunded if the request is cancelled, fails, or finishes below the provisional estimate.

## POST /external_users/upload_image_data

Upload image data URLs for an external user before calling `image_list_to_video`.

```json
{
  "external_user": {
    "provider": "whop",
    "external_user_id": "usr_123",
    "external_app_id": "app_abc"
  },
  "input": {
    "image_data": [
      "data:image/png;base64,..."
    ]
  }
}
```

Success response:

```json
{
  "image_urls": [
    "https://static.samsar.one/..."
  ]
}
```

## POST /external_users/image_list_to_video

Create a video from an ordered list of images attributed to an external user.

```bash
curl -X POST https://api.samsar.one/v1/external_users/image_list_to_video \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "external_user": {
      "provider": "whop",
      "external_user_id": "usr_123",
      "external_app_id": "app_abc"
    },
    "input": {
      "image_urls": [
        "https://cdn.example.com/frame1.png",
        "https://cdn.example.com/frame2.png"
      ],
      "prompt": "Fast product reveal pacing",
      "video_model": "RUNWAYML",
      "aspect_ratio": "9:16",
      "metadata": {
        "campaign": "drop-07"
      },
      "language": "en",
      "enable_subtitles": true,
      "font_key": "Poppins",
      "limit_single_narrator": false,
      "add_narrator_avatar": false
    }
  }'
```

`input` uses the same image-list contract as [`POST /video/image_list_to_video`](/video#post-videoimage_list_to_video), including current image, video, inference, music, TTS, subtitle, outro, footer, and narrator options. External-user differences are limited to scoped identity, credit reservation/refunds, and request history.

The route defaults to `RUNWAYML` when `video_model` is omitted and supports `16:9` or `9:16`. Billing uses the central video model rates; narrator avatars add **4 credits/sec** and express CTA generation adds **1 credit/sec**. Response headers report the accepted charge and remaining external-user balance when available.

## GET /external_users/status

Poll an external request until completion.

```bash
curl "https://api.samsar.one/v1/external_users/status?request_id=extreq_123" \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************"
```

Success response:

```json
{
  "request_id": "extreq_123",
  "session_id": "extreq_123",
  "external_request_id": "extreq_123",
  "upstream_session_id": "66ff...",
  "status": "COMPLETED",
  "result_url": "https://static.samsar.one/...",
  "has_subtitles": true,
  "result_language": "en",
  "creditsCharged": 750,
  "creditsRefunded": 0,
  "remainingCredits": 4250
}
```

Completed video responses include `has_subtitles` and `result_language` when the upstream video session has that metadata. If a generation fails or completes with a refund, the external request record is updated to reflect the refund.

## GET /external_users/requests

Fetch recent render requests for one external user.

```bash
curl "https://api.samsar.one/v1/external_users/requests?provider=whop&external_user_id=usr_123&external_app_id=app_abc&limit=12" \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************"
```

Success response:

```json
{
  "requests": [
    {
      "request_id": "extreq_123",
      "route_key": "text_to_video",
      "status": "COMPLETED",
      "prompt": "A cinematic teaser for a new sneaker drop",
      "video_url": "https://static.samsar.one/...",
      "credits_charged": 750,
      "credits_refunded": 0,
      "remaining_credits": 4250,
      "is_published": true,
      "published_title": "Sneaker teaser"
    }
  ],
  "external_user": {
    "provider": "whop",
    "external_user_id": "usr_123"
  }
}
```

## POST /external_users/publish

Publish a completed external-user request to the public library/feed.

```bash
curl -X POST https://api.samsar.one/v1/external_users/publish \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "extreq_123",
    "title": "Sneaker teaser",
    "description": "Launch-day vertical cut",
    "tags": ["launch", "footwear"]
  }'
```

Success response:

```json
{
  "request": {
    "request_id": "extreq_123",
    "is_published": true,
    "published_title": "Sneaker teaser"
  },
  "publication": {
    "_id": "pub_123"
  }
}
```

## POST /external_users/archive

Archive an external-user request. This costs no credits and also removes the video from publications if it was already published.

```bash
curl -X POST https://api.samsar.one/v1/external_users/archive \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "extreq_123"
  }'
```

Success response:

```json
{
  "request": {
    "request_id": "extreq_123",
    "status": "ARCHIVED"
  }
}
```

## GET /external_users/credits

Fetch the remaining credits for one external user plus their attribution summary.

```bash
curl "https://api.samsar.one/v1/external_users/credits?provider=whop&external_user_id=usr_123&external_app_id=app_abc" \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************"
```

Success response:

```json
{
  "remainingCredits": 4920,
  "lastTopUp": {
    "amountPaidCents": 5000,
    "creditsApplied": 5000
  },
  "externalUser": {
    "provider": "whop",
    "external_user_id": "usr_123",
    "generation_credits": 4920,
    "total_requests": 4,
    "total_credits_used": 1820,
    "total_credits_refunded": 150,
    "total_credits_purchased": 5000
  }
}
```

## POST /external_users/credits/grant

Manually mint credits for an external user and the shared platform account so upstream balances stay in sync. This endpoint requires a signed-in administrator's user auth token in `Authorization: Bearer <ADMIN_AUTH_TOKEN>`. Customer or parent-account API keys, APP_KEY credentials, external-user auth tokens, and customer sub-account keys are not authorized.

The target external user must belong to the authenticated administrator's account; targets owned by another account return `403`. `input.credits` must be a positive safe integer (at most `9007199254740991`).

This is an administrative operation, not a customer self-service top-up. For paid credit purchases, use [`POST /external_users/credits/recharge`](#post-external_userscreditsrecharge).

```bash
curl -X POST https://api.samsar.one/v1/external_users/credits/grant \
  -H "Authorization: Bearer <ADMIN_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "external_user": {
      "provider": "whop",
      "external_user_id": "usr_123",
      "external_app_id": "app_abc"
    },
    "input": {
      "credits": 1000
    }
  }'
```

Success response:

```json
{
  "creditsGranted": 1000,
  "remainingCredits": 1000,
  "externalUser": {
    "provider": "whop",
    "external_user_id": "usr_123",
    "generation_credits": 1000
  }
}
```

Manual grants return `403` when authenticated without a signed-in administrator's user auth token.

## POST /external_users/credits/recharge

Create a Stripe checkout link for an external-user credit purchase.

```json
{
  "external_user": {
    "provider": "whop",
    "external_user_id": "usr_123",
    "external_app_id": "app_abc"
  },
  "input": {
    "credits": 2500
  }
}
```

Success response:

```json
{
  "external_payment_id": "extpay_123",
  "url": "https://checkout.stripe.com/c/pay/...",
  "checkoutSessionId": "cs_test_123",
  "paymentIntentId": "pi_123",
  "paymentStatusEndpoint": "/v1/external_users/payment_status",
  "credits": 2500,
  "amountUsd": 25,
  "amountCents": 2500,
  "currency": "USD"
}
```

## GET /external_users/payment_status

Poll the status of an external-user-attributed recharge.

```bash
curl "https://api.samsar.one/v1/external_users/payment_status?external_payment_id=extpay_123" \
  -H "Authorization: Bearer YOUR_PLATFORM_API_KEY_****************" \
  -H "x-external-user-api-key: YOUR_EXTERNAL_USER_API_KEY_****************"
```

Success response:

```json
{
  "external_payment_id": "extpay_123",
  "status": "succeeded",
  "mode": "payment",
  "checkoutSessionId": "cs_test_123",
  "paymentIntentId": "pi_123",
  "amountCents": 2500,
  "currency": "usd",
  "remainingCredits": 5000
}
```

When payment succeeds, credits are applied to the external user’s `generationCredits`. The underlying platform API key is not returned to the caller.


<a id="document-0097c8810e57e6da13cab6ad4c1a77c3"></a>
## Fonts

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/fonts

# Fonts

Use these previews to choose subtitle fonts by language. Font keys are shown inside each image and match the values returned by `GET /supported_fonts`. Samples automatically switch between light and dark assets based on the docs theme.

## Default (default) {#default}

- **Rampart One**

- **Montserrat**

- **Arial**

- **sans-serif**

## English (en) {#en}

- **Poppins**

- **Montserrat**

- **Arial**

- **sans-serif**

## French (fr) {#fr}

- **Poppins**

- **Montserrat**

- **Arial**

- **sans-serif**

## Spanish (es) {#es}

- **Rampart One**

- **Montserrat**

- **Arial**

- **sans-serif**

## German (de) {#de}

- **Rampart One**

- **Montserrat**

- **Arial**

- **sans-serif**

## Portuguese (pt) {#pt}

- **Rampart One**

- **Montserrat**

- **Arial**

- **sans-serif**

## Italian (it) {#it}

- **Rampart One**

- **Montserrat**

- **Arial**

- **sans-serif**

## Dutch (nl) {#nl}

- **Rampart One**

- **Montserrat**

- **Arial**

- **sans-serif**

## Swedish (sv) {#sv}

- **Rampart One**

- **Montserrat**

- **Arial**

- **sans-serif**

## Russian (ru) {#ru}

- **Arial**

- **sans-serif**

## Japanese (ja) {#ja}

- **Noto Sans JP**

- **M PLUS Rounded 1c**

- **Hiragino Sans**

- **Yu Gothic UI**

- **sans-serif**

## Korean (ko) {#ko}

- **Noto Sans KR**

- **Pretendard**

- **Apple SD Gothic Neo**

- **Malgun Gothic**

- **sans-serif**

## Thai (th) {#th}

- **Sarabun**

- **Tahoma**

- **Leelawadee UI**

- **sans-serif**

## Arabic (ar) {#ar}

- **Noto Sans Arabic**

- **Cairo**

- **Geeza Pro**

- **Segoe UI**

- **sans-serif**

## Bengali (bn) {#bn}

- **Noto Sans Bengali**

- **Hind Siliguri**

- **Noto Serif Bengali**

- **sans-serif**

## Hindi (hi) {#hi}

- **Noto Sans Devanagari**

- **Mukta**

- **Hind**

- **Noto Serif Devanagari**

- **Kohinoor Devanagari**

- **sans-serif**

## Hebrew (he) {#he}

- **Noto Sans Hebrew**

- **Rubik**

- **Arial Hebrew**

- **sans-serif**

## Latin (la) {#la}

- **Rampart One**

- **Montserrat**

- **Arial**

- **sans-serif**

## Sanskrit (sa) {#sa}

- **Noto Sans Devanagari**

- **Mukta**

- **Hind**

- **Noto Serif Devanagari**

- **Kohinoor Devanagari**

- **sans-serif**

## Chinese (zh) {#zh}

- **Noto Sans SC**

- **Source Han Sans SC**

- **PingFang SC**

- **Microsoft YaHei**

- **sans-serif**

## Chinese (Simplified) (zh-cn) {#zh-cn}

- **Noto Sans SC**

- **Source Han Sans SC**

- **PingFang SC**

- **Microsoft YaHei**

- **sans-serif**

## Chinese (Traditional) (zh-tw) {#zh-tw}

- **Noto Sans TC**

- **Source Han Sans TC**

- **PingFang TC**

- **Microsoft JhengHei**

- **sans-serif**


<a id="document-577ae37eeeb0614a90c86838def23a7c"></a>
## Hosted Samsar.js & deployment adapters

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/adapters

# Hosted Samsar.js & deployment adapters

Use **Samsar.js with the hosted Samsar API** as the starting point for media, workflows, search and delivery. When you operate a standalone installation, the same workflows can use supported local provider adapters. Native inference and custom model endpoints can take precedence where their model contract requires it.

## Choose your path

| Path | What you configure | Where work runs | Start here |
| --- | --- | --- | --- |
| Hosted Studio | Samsar account | Managed Samsar services | [Open Studio](https://app.samsar.one) |
| Hosted API with Samsar.js | Samsar API key in your server environment | Managed Samsar services and their upstream providers | [SDK quick start](/#make-your-first-request) |
| Standalone with Samsar.js adapter | Local Samsar installation + `SAMSAR_API_KEY` | Local orchestration; supported generation calls use hosted Samsar | [External requests](/external-requests) |
| Standalone with native/provider adapters | Local installation + the supported provider credentials | Local orchestration; model calls use configured providers | [Model matrix](/models) |
| Custom model endpoint | Compatible endpoint, authorization and model configuration | Your model endpoint and local Samsar orchestration | [Custom image utility](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) |

Calling the hosted API and selecting the Samsar adapter inside a standalone deployment are two different uses of Samsar.js. The SDK is a client; it does not deploy a model or turn provider credentials into a running service.

## Start with hosted Samsar.js

```bash
npm install samsar-js
```

```js

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const job = await samsar.createVideoFromText({
  prompt: 'A calm travel film about a morning beside the sea.',
  image_model: 'GPTIMAGE2.5',
  video_model: 'RUNWAYML',
  duration: 30,
  aspect_ratio: '16:9',
  tts_model: 'OPENAI',
  backingtrack_model: 'LYRIA3',
});
// Save this ID. Generation continues asynchronously.
const requestId = job.data.request_id;
const status = await samsar.getStatus(requestId);
console.log(status.data);
```

The default base URL is `https://api.samsar.one/v1`. Keep the key on your server. Poll according to the [Video API](/video#get-status), or pass a webhook where supported. Hosted charges use Samsar credits; [pricing](/pricing) and response credit headers describe billing.

Use the same SDK against a standalone processor

```js
const local = new SamsarClient({
  apiKey: process.env.SAMSAR_LOCAL_API_KEY,
  baseUrl: 'http://localhost:3002/v1',
});
const available = await local.getSupportedTextToVideoModels();
console.log(available.data);
```

Use a key accepted by that local processor. Changing `baseUrl` changes the API host; it does not configure provider credentials. Add those in the setup wizard on the standalone installation.

## Expand into supported adapters

Open **Providers** in the [setup wizard](https://github.com/samsarone/samsar/blob/main/pages/setup-wizard.md). The Samsar API key appears first, followed by optional Inference, GMICloud, and Media provider groups. Each provider has a model tooltip and a link to obtain credentials. Continue is highlighted when the entered combination covers the required capabilities; credential validation then determines availability.

- **Samsar.js**: Call the hosted Samsar service using Samsar credits. The samsar-js client is the common entry point. Credentials: SAMSAR_API_KEY. Docs: https://docs.samsar.one/external-requests
- **OpenAI**: Native GPT inference, image and speech adapters; also required for local embedding indexes. Credentials: OPENAI_API_KEY. Docs: https://platform.openai.com/docs/overview
- **Anthropic**: Native Claude inference and assistant adapter. Credentials: ANTHROPIC_API_KEY. Docs: https://platform.claude.com/docs/en/api/overview
- **Google Cloud**: Gemini, Nano Banana, Veo, Google speech and Lyria. Music credentials and model access are validated separately. Credentials: Google service account / configured Google credentials. Docs: https://cloud.google.com/vertex-ai/generative-ai/docs
- **Kimi**: Native Kimi text, vision and structured output; Samsar is the supported alternative. Credentials: KIMI_K3_API_KEY. Docs: https://platform.kimi.ai/docs/overview
- **Alibaba Cloud**: Native Qwen inference in Docker, Qwen Image, Wan and Happy Horse. Qwen Image requires standard pay-as-you-go access. Credentials: ALIBABA_API_KEY. Docs: https://www.alibabacloud.com/help/en/model-studio/
- **GMICloud via GenBlaze**: Only exact model and operation mappings validated for your credential are enabled by the local GenBlaze gateway. Credentials: GMI_API_KEY. Docs: https://docs.gmicloud.ai/ Adapter: https://github.com/backblaze-labs/genblaze
- **fal**: Supported media, speech, music, lip-sync and sound-effect adapters. Credentials: FAL_API_KEY. Docs: https://fal.ai/docs/documentation
- **OpenRouter**: Supported inference and vision routes. This does not enable image, video or audio generation. Credentials: OPENROUTER_API_KEY. Docs: https://openrouter.ai/docs/quickstart
- **ElevenLabs**: Direct music adapter. Speech is enabled through fal in the setup registry; do not assume a direct key enables every speech route. Credentials: ELEVENLABS_API_KEY. Docs: https://elevenlabs.io/docs/overview/intro
- **Runway**: Native Runway video adapter. Credentials: RUNWAY_API_KEY. Docs: https://docs.dev.runwayml.com/
- **Custom endpoint**: Register a compatible endpoint in your standalone deployment. Available only after configuration. Credentials: Adapter URL and server-side authorization. Docs: https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md

## Understand ordering and fallback

The documentation begins with hosted Samsar.js. A standalone runtime still uses its validated provider configuration and saved preferences. Native inference may lead a model’s chain; optional media adapters can be reordered where the settings expose that model.

1. Setup writes `runtime/config/available-models.json` from validated providers.
2. **Settings → Model Adapters** lets a standalone administrator reorder available inference, text-to-image and image-to-video adapters.
3. Overrides live in `runtime/config/model-adapter-preferences.json`; rendering config preserves them.
4. A definitive failure can advance a supported fallback chain. An asynchronous job already accepted by a provider stays pinned to that provider while polling.

These controls are specific to standalone installations. Hosted routing is managed by Samsar. Adding a provider to the table does not mean it is compatible with every model from that provider.

## Model-specific exceptions

| Model or operation | What to know |
| --- | --- |
| Kimi K3 | Native Kimi first, Samsar alternative; OpenRouter is not in the Kimi chain. Use `kimi-k3` in inference requests; `KIMIK3` is the setup key. |
| Qwen inference | Hosted `QWEN3.8` uses OpenRouter internally. Native Alibaba Qwen is a Docker option. |
| Qwen Image 3.0 Pro | `QWENIMAGE3PRO` requires the native Alibaba adapter with standard pay-as-you-go credentials. A Token Plan key does not enable this model. |
| GPTImage 2.6 | Use stable keys `GPTIMAGE2.5` and `GPTIMAGE2.5EDIT`, now targeting 2.6 Sunburst at High quality. Retired `GPTIMAGE2` and `GPTIMAGE2EDIT` keys are rejected for new requests. Older GenBlaze GPT Image 2 mappings are excluded from these contracts. |
| Seedance 2.0 | Provider-billed standalone I2V via fal or the exact validated GenBlaze route; no Samsar adapter in the setup registry. |
| Seedance 2.5 | Uses 5, 10 or 15 second 720p scene buckets. Agent/Vidgenie is 60 credits/sec; standard Express is 50. Direct clips use separate model-call pricing. |
| Kling 4 | `KLINGIMGTOVID4` / `KLINGTXTTOVID4`: 720p, no native audio, 5–30-second clips in five-second steps. Old 3 Pro/Turbo keys are compatibility aliases for new requests. |
| GMICloud via GenBlaze | Only exact, credential-validated model/operation mappings are exposed. Approximate model matches do not enable a route. |
| ElevenLabs speech | The hosted speech contract accepts `ELEVENLABS`; standalone setup advertises speech through fal. Direct ElevenLabs music has its own adapter. |
| Local search and recommendations | Local embedding indexes require `OPENAI_API_KEY`; URL crawling also requires `FIRECRAWL_API_KEY`. A Samsar key alone does not satisfy that local implementation. Hosted clients use Samsar.js. |

## Verify before generating

Use [Express model discovery](/video#get-videosupported_models) for video workflow allowlists and the [provider capability API](/external-requests#provider-capabilities) for onboarding capabilities. Neither is a live guarantee of every upstream model. Local generated configuration and validated GenBlaze mappings determine what your own deployment can offer.

See the [repository provider guide](https://github.com/samsarone/samsar/blob/main/pages/providers-and-models.md) for runtime details and the [model matrix](/models) to compare compatible choices.

## GPT and Claude model choices

Text inference, vision, and assistant requests support these models at `high` or `xhigh` effort:

| Samsar model | Native provider model | OpenRouter model |
| --- | --- | --- |
| `gpt-6-astra` | `gpt-6-astra` | `openai/gpt-6-astra` |
| `gpt-6.1-sol` | `gpt-6.1-sol` | `openai/gpt-6.1-sol` |
| `claude-opus-5.5` | `claude-opus-5-5` | `anthropic/claude-opus-5.5` |
| `claude-fable-5.1` | `claude-fable-5-1` | `anthropic/claude-fable-5.1` |

Use `OPENAI_API_KEY` for native GPT, `ANTHROPIC_API_KEY` for native Claude, or `OPENROUTER_API_KEY` for OpenRouter. Samsar-hosted requests use `SAMSAR_API_KEY`. Existing defaults remain GPT 6 Astra and `high`; selecting Sol no longer redirects to Astra. Saved `-xhigh` model aliases remain accepted.

Production and standalone deployments prefer native Anthropic for Claude text and vision requests when `ANTHROPIC_API_KEY` is configured. OpenRouter remains the next configured provider when that key is absent; explicit provider selection is preserved. This applies to both Claude models at High and XHigh effort.

For pipeline and narrative calls, set `inference_model` and `effort`. For chat calls, set `model` and `reasoning: { effort: "xhigh" }` (or `"high"`). Account, Vidgenie, and Assistant selectors expose both model families and effort levels; standalone installations show only configured models.

Assistant token rates are listed on the pricing page. High and XHigh use the same per-token rates; total charges depend on actual input, cached input, and output usage. Thinking tokens count as output tokens.


<a id="document-7e8068aa200a028429c0c79326e7112d"></a>
## Image API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/image-api

# Image API

Compare [image generation](/models?modality=image) and [image editing](/models?modality=image-edit) models, including their supported adapters. Start with hosted **samsar-js** and use the [deployment guide](/adapters) when configuring your own providers.

Run enhance or branding removal calls in the Playground and poll their status before wiring them into code.

**Quick facts**

- Base URL: `https://api.samsar.one/v1`
- Authentication: `Bearer API key`
- Execution: `Generation and edits are async; title assignment is synchronous`
- Billing: `Route-specific; credit headers report usage`
- Content type: `application/json`

Poll `/image/status?request_id=...` (or `/v1/status`) for asynchronous work, or use `/image/list` to fetch history.

## Pricing

| Endpoint                 | Credits                                           | Notes                                                         |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------- |
| `POST /image/text_to_image` | Selected model rates | Charged on completion; defaults to `NANOBANANA2`. |
| `POST /image/assign_title` | Usage-based credits                         | Image title generation. Returns synchronously. |
| `POST /image/enhance` | Selected model rates | Configuration includes `resolution` (defaults to `1k`). |
| `POST /image/remove_branding` | Selected model rates | Charged on completion of the image edit. |
| `POST /image/add_image_set` | Selected model rates | Final charge covers completed image-model calls. |
| `POST /image/receipt_templates/create` | Free                                | Builds and saves a receipt template + normalized schema from one sample image. |
| `GET /image/template_json` | Free                                            | Returns the saved structured template JSON for a `template_id` owned by your API key. |
| `POST /image/receipt_templates/query` | 50                                     | Validates receipt against template and returns standardized JSON fields. |
| `POST /image/create_rollup_banner` | 30                                        | Flat per request.                                              |
| `POST /image/enhance_and_generate_rollup_banner` | Variable                              | Enhance credits for low-res images + 30 credits per rollup request. |

See the final image token and output prices for the listed model and adapter routes. Text, image, output, and cached-input token prices are shown separately where supported. Final charges depend on the actual adapter, model configuration, and usage.

### Final image token prices

Credits per one million tokens for the named native adapter and token category. The listed generation and edit keys use the same rates. A dash means the token category does not apply; text output includes reasoning tokens when reported.

| Model | Adapter | Token category | Input | Cached input | Output |
| --- | --- | --- | --- | --- | --- |
| `GPTIMAGE2.5 / GPTIMAGE2.5EDIT` | OpenAI | Text tokens | 600 | — | — |
| `GPTIMAGE2.5 / GPTIMAGE2.5EDIT` | OpenAI | Image tokens | 960 | — | 3,600 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google global | Text tokens | 60 | 6 | 360 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google global | Image tokens | 60 | 6 | 7,200 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google regional | Text tokens | 66 | 6.6 | 396 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google regional | Image tokens | 66 | 6.6 | 7,920 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google global | Text tokens | 240 | 24 | 1,440 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google global | Image tokens | 240 | 24 | 14,400 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google regional | Text tokens | 264 | 26.4 | 1,584 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google regional | Image tokens | 264 | 26.4 | 15,840 |

### Final output image prices

Credits per generated image for the listed native adapter and configuration.

| Model | Adapter | Configuration | Credits / output image |
| --- | --- | --- | --- |
| `DALLE3` | OpenAI | Standard · 1024×1024 | 4.8 |
| `DALLE3` | OpenAI | Standard · 1792×1024 or 1024×1792 | 9.6 |
| `IMAGEN3` | Google | Standard generation | 4.8 |
| `IMAGEN3FLASH` | Google | Fast generation | 2.4 |
| `WAN2.7PRO` | Alibaba international | 1K | 9 |
| `QWENIMAGE3PRO` | Alibaba international | 1K | 4.8 |
| `QWENIMAGE3PRO` | Alibaba international | 2K | 9 |
| `WAN2.7PRO` | Alibaba China / global | 1K | 8.25132 |
| `QWENIMAGE3PRO` | Alibaba China / global | 1K | 4.1256 |
| `QWENIMAGE3PRO` | Alibaba China / global | 2K | 8.25132 |

Fal-backed hosted image calls use these checked-in final rates:

| Model key | Configuration | Final hosted charge |
| --- | --- | --- |
| [`FLUX1DEV`](https://fal.ai/models/fal-ai/flux/dev) | Flux Dev | 3 credits / billed MP |
| [`FLUX1PRO`](https://fal.ai/models/fal-ai/flux-pro/new) | Flux Pro | 6 credits / billed MP |
| [`FLUX1.1PRO`](https://fal.ai/models/fal-ai/flux-pro/v1.1) | Flux 1.1 Pro | 4.8 credits / billed MP |
| [`FLUX1.1ULTRA`](https://fal.ai/models/fal-ai/flux-pro/v1.1-ultra) | Flux 1.1 Ultra | 7.2 credits / output image |
| [`RECRAFTV3`](https://fal.ai/models/fal-ai/recraft-v3) | Recraft V3, normal / vector illustration | 4.8 / 9.6 credits per image |
| [`RECRAFT20B`](https://fal.ai/models/fal-ai/recraft-20b) | Recraft 20B, normal / vector illustration | 2.628 / 5.256 credits per image |
| [`IDEOGRAMV3`](https://fal.ai/models/fal-ai/ideogram/v3) | Ideogram V3, BALANCED default | 7.2 credits / output image |
| [`WAN2.7PRO`](https://fal.ai/models/fal-ai/wan/v2.7/pro/text-to-image) | Wan 2.7 Pro text to image | 9 credits / output image |
| [`NANOBANANA2 / NANOBANANAPRO`](https://fal.ai/models/fal-ai/nano-banana-2) | Both keys currently route to Nano Banana 2, 1K default | 9.6 credits / output image |
| [`NANOBANANA2EDIT / NANOBANANAPROEDIT / NANOBANANAEDIT`](https://fal.ai/models/fal-ai/nano-banana-2/edit) | Nano Banana 2 edit; enhance supports resolution tiers, other edits use 1K; image sets allow up to four outputs | 7.2 / 9.6 / 14.4 / 19.2 credits per image at 0.5K / 1K / 2K / 4K |
| [`FLUX1.1PROREDUX`](https://fal.ai/models/fal-ai/flux-pro/v1.1/redux) | Flux 1.1 Pro Redux, submitted image size | 6 credits / billed MP |
| [`BRIA_ERASER`](https://fal.ai/models/fal-ai/bria/eraser) | Bria erase | 4.8 credits / generation |
| [`BRIA_GENFILL`](https://fal.ai/models/fal-ai/bria/genfill) | Bria fill | 4.8 credits / generation |
| [`BRIA_BACKGROUNDREMOVE`](https://fal.ai/models/fal-ai/bria/background/remove) | Bria background removal | 2.16 credits / generation |

Each output is charged using the listed configuration. Supported Flux routes use one billable 1024×1024 megapixel unit at their constrained submitted sizes. The worker saves the tariff before submission; a model or option without a verified tariff stops before a new paid Fal call. The table identifies edit resolutions and configuration-dependent prices.

Hosted direct Fal routes for `SDV3.5`, `SANA`, `SANA4.5B`, `SANASPRINT`, `PHOTON`, `PHOTONFLASH`, `LUMINAV2`, `REVE`, `HIDREAMI1`, `HUNYUAN`, `FLUX1PROFILL` and `FLUX1.1PROULTRAREDUX` are unavailable under this billing policy until their megapixel billing rule or output sizing is verified. Fal routes for `IMAGEN4`, `FLITE`, `SEEDREAM` and `GPTIMAGE2.5` lack a verified tariff. Other adapters for these model keys may still be available.

Other adapter routes report configuration-specific final charges in their completion receipts. Their prices should not be inferred from another adapter's table.

### Completion billing

Studio generation, edits, enhancements, and reroll image calls use the same completion billing as these endpoints. Production agent pipelines retain their flat stage pricing. Standalone Docker does not debit local image credits; calls through the Samsar.js adapter are charged by the hosted image endpoint.

Image submissions return `creditsCharged: 0` and `billingStatus: "PENDING"`. Poll `/image/status` for the final `creditsCharged`, `remainingCredits`, and matching credit headers. Billing confirmation can keep a request pending after generation finishes.

Use the same `Idempotency-Key` header when retrying a logical image submission. In Samsar.js request options, pass `{ idempotencyKey: 'stable-image-request' }`. The same key and payload reuse the queued job and original charge; a changed payload returns `409`. Polling does not create another model call or charge.

## POST /image/text_to_image

Generate one or more images from a text prompt. This route is also available as `/image/generate` and `/image/generations`.

Use the stable request key `GPTIMAGE2.5` for **GPTImage 2.6 Sunburst (High)**.
The key is retained for compatibility; native OpenAI and fal generation now target 2.6 Sunburst. The retired key `GPTIMAGE2` is not an alias:
new requests return HTTP 400 with `Invalid model: GPTIMAGE2. Use GPTIMAGE2.5.`
This validation also applies to the `mode` field and the v2 image-generation routes.

```json
{
  "prompt": "A minimal product still life on warm stone, soft daylight.",
  "model": "NANOBANANA2",
  "aspect_ratio": "1:1",
  "num_images": 1
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `prompt` | Yes | Non-empty generation prompt. |
| `model` or `mode` | No | `GPTIMAGE2.5`, `NANOBANANA2` (default), `NANOBANANAPRO`, `SEEDREAM`, or `WAN2.7PRO`. |
| `aspect_ratio` or `aspectRatio` | No | Defaults to `1:1`; Wan 2.7 Pro accepts `1:1`, `16:9`, or `9:16`. |
| `resolution` | No | Wan 2.7 Pro accepts `1K`; other models ignore this field. |
| `num_images` or `numImages` | No | Positive output count; defaults to `1`. See the final model prices and completion receipt. |

**Success response (200)**

```json
{
  "status": "queued",
  "request_id": "img_gen_123",
  "session_id": "img_gen_123",
  "case_type": "text_to_image",
  "model": "NANOBANANA2",
  "aspect_ratio": "1:1",
  "num_images": 1,
  "creditsCharged": 0,
  "remainingCredits": null,
  "billingStatus": "PENDING"
}
```

Poll `GET /image/status?request_id=img_gen_123` until the request is complete.

## POST /image/assign_title

Assign a short SEO-friendly title to an image. The title is suitable for an image title or for client-side filename generation after camel-casing.

This endpoint uses two generation steps:

1. Analyze the image in low-detail vision mode for naming-relevant visual cues.
2. Combine that description with optional metadata JSON to create one short title.

**JSON request body**

```json
{
  "image_url": "https://cdn.example.com/product-photo.png",
  "metadata": {
    "product": "linen travel shirt",
    "collection": "spring essentials"
  }
}
```

You can also send `image_data` as a base64 image data URL.

**Multipart request**

```bash
curl -X POST "https://api.samsar.one/v1/image/assign_title" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -F "image=@./product-photo.png" \
  -F 'metadata={"product":"linen travel shirt","collection":"spring essentials"}'
```

Supported image file types are PNG, JPEG, WEBP, and non-animated GIF.

**Success response (200)**

```json
{
  "content": "Linen Travel Shirt"
}
```

Response headers include:

- `x-credits-charged: <credits>`
- `x-credits-remaining: <remaining>`

## POST /image/enhance

Upscale and denoise an image.

**Request body**

```json
{
  "image_url": "https://cdn.example.com/photo.png",
  "resolution": "0.5k | 1k | 2k | 4k"
}
```

- `image_url` required, non-empty URL.
- `resolution` optional; defaults to `1k`.

**Success response (200)**

```json
{
  "status": "queued",
  "request_id": "img_enh_123",
  "session_id": "img_enh_123",
  "global_status_id": "img_enh_123",
  "case_type": "image_enhance",
  "image_url": "https://cdn.example.com/photo.png",
  "resolution": "1K",
  "aspect_ratio": "16:9",
  "creditsCharged": 0,
  "remainingCredits": null,
  "billingStatus": "PENDING"
}
```

## POST /image/remove_branding

Remove visible text from an image.

**Request body**

```json
{
  "image_url": "https://cdn.example.com/watermarked.png"
}
```

**Success response (200)**

```json
{
  "status": "queued",
  "request_id": "img_rm_123",
  "session_id": "img_rm_123",
  "global_status_id": "img_rm_123",
  "case_type": "logo_remove",
  "image_url": "https://cdn.example.com/watermarked.png",
  "creditsCharged": 0,
  "remainingCredits": null,
  "billingStatus": "PENDING"
}
```

## POST /image/add_image_set

Extend or save a set of images for downstream generation.

**Request body**

```json
{
  "image_urls": [
    "https://cdn.example.com/look1.png",
    "https://cdn.example.com/look2.png"
  ],
  "metadata": { "campaign": "spring" },
  "prompt": "Optional creative direction",
  "num_images": 4
}
```

- `image_urls` required, non-empty array of strings.
- `num_images` optional positive number; defaults to `image_urls.length` when omitted.
- `prompt` optional string; `metadata` optional object.

**Success response (200)**

```json
{
  "status": "queued",
  "request_id": "img_set_123",
  "session_id": "img_set_123",
  "global_status_id": "img_set_123",
  "case_type": "image_list_to_image_set",
  "image_urls": [
    "https://cdn.example.com/look1.png",
    "https://cdn.example.com/look2.png"
  ],
  "metadata": { "campaign": "spring" },
  "prompt": "Optional creative direction",
  "num_images": 4,
  "creditsCharged": 0,
  "remainingCredits": null,
  "billingStatus": "PENDING"
}
```

## POST /image/receipt_templates/create

Create and persist a reusable receipt extraction template from a sample receipt image.

This endpoint is free (no credits deducted).

**Request body**

```json
{
  "image_url": "https://cdn.example.com/receipt-template.png",
  "template_name": "kbank-transfer-template"
}
```

- `image_url` required, public image URL.
- `template_name` optional.

**Success response (200)**

```json
{
  "template_id": "receipt_tpl_0e4f9f1dca744ec9b3a3f8df",
  "template_hash": "f8b8f4e6e7d9b66d3f4a9e6f35b17c4d7ac4dce2f0d63f15e2d55b9872e3be35",
  "template_name": "kbank-transfer-template",
  "normalized_template": {
    "schema_version": "1.0",
    "merchant_hint": "Kasikornbank",
    "currency_hint": "THB",
    "rois": [
      { "id": "meta_header", "label": "Header and Meta", "left": 0, "top": 0, "width": 1, "height": 0.35 },
      { "id": "line_items", "label": "Line Items/Table", "left": 0, "top": 0.28, "width": 1, "height": 0.5 },
      { "id": "totals", "label": "Totals", "left": 0.45, "top": 0.7, "width": 0.55, "height": 0.3 }
    ],
    "fields": [
      { "key": "merchant_name", "type": "string", "required": true },
      { "key": "transaction_date", "type": "date", "required": true },
      { "key": "total", "type": "currency", "required": true }
    ],
    "validation_rules": {
      "arithmetic": true,
      "amount_tolerance": 0.05
    }
  },
  "sample_receipt": {
    "merchant_name": "Kasikornbank",
    "transaction_date": "2026-01-14",
    "total": 786
  }
}
```

## POST /image/receipt_templates/query

Extract receipt fields by validating an input receipt image against an existing template.

This endpoint charges **50 credits** per request.

**Request body**

```json
{
  "template_id": "receipt_tpl_0e4f9f1dca744ec9b3a3f8df",
  "image_url": "https://cdn.example.com/receipt-instance.png"
}
```

- `template_id` required.
- `image_url` required.
- The template must belong to the same API key. Cross-account template access returns `404`.

**Success response (200)**

```json
{
  "template_id": "receipt_tpl_0e4f9f1dca744ec9b3a3f8df",
  "template_hash": "f8b8f4e6e7d9b66d3f4a9e6f35b17c4d7ac4dce2f0d63f15e2d55b9872e3be35",
  "template_name": "kbank-transfer-template",
  "receipt_json": {
    "merchant_name": "Kasikornbank",
    "transaction_date": "2026-01-14",
    "transaction_id": "TRBS260114764844309",
    "currency": "THB",
    "fee": 0,
    "total": 786
  },
  "standardized_receipt": {
    "merchant_name": "Kasikornbank",
    "transaction_date": "2026-01-14",
    "transaction_time": "17:25",
    "transaction_id": "TRBS260114764844309",
    "currency": "THB",
    "subtotal": 786,
    "tax": null,
    "fee": 0,
    "discount": null,
    "total": 786,
    "payment_method": "transfer",
    "from_account": "xxx-x-xxxx-x",
    "to_account": "xxx-x-xxxx-x"
  },
  "items": [],
  "unreadable_fields": [],
  "confidence": 0.93,
  "validation": {
    "is_valid": true,
    "issues": []
  },
  "attempts": 1
}
```

Response headers include:
- `x-credits-charged: 50`
- `x-credits-remaining: <remaining>`

## GET /image/template_json

Fetch a saved structured receipt template by `template_id`.

This endpoint validates ownership against your API key and returns the template JSON only when the template belongs to that user.

Primary route: `GET /image/template_json`
Alias route: `GET /image/receipt_templates/template_json`

**Query params**

- `template_id` required.

**Sample request**

```bash
curl "https://api.samsar.one/v1/image/template_json?template_id=receipt_tpl_0e4f9f1dca744ec9b3a3f8df" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Success response (200)**

```json
{
  "template_id": "receipt_tpl_0e4f9f1dca744ec9b3a3f8df",
  "template_hash": "f8b8f4e6e7d9b66d3f4a9e6f35b17c4d7ac4dce2f0d63f15e2d55b9872e3be35",
  "template_name": "kbank-transfer-template",
  "source_image_url": "https://cdn.example.com/receipt-template.png",
  "normalized_template": {
    "schema_version": "1.0",
    "merchant_hint": "Kasikornbank",
    "currency_hint": "THB",
    "rois": [
      { "id": "meta_header", "label": "Header and Meta", "left": 0, "top": 0, "width": 1, "height": 0.35 },
      { "id": "line_items", "label": "Line Items/Table", "left": 0, "top": 0.28, "width": 1, "height": 0.5 },
      { "id": "totals", "label": "Totals", "left": 0.45, "top": 0.7, "width": 0.55, "height": 0.3 }
    ],
    "fields": [
      { "key": "merchant_name", "type": "string", "required": true },
      { "key": "transaction_date", "type": "date", "required": true },
      { "key": "total", "type": "currency", "required": true }
    ],
    "validation_rules": {
      "arithmetic": true,
      "amount_tolerance": 0.05
    }
  },
  "template_json": {
    "schema_version": "1.0"
  },
  "sample_receipt": {
    "merchant_name": "Kasikornbank",
    "transaction_date": "2026-01-14",
    "total": 786
  },
  "created_at": "2026-03-01T00:26:29.478Z",
  "updated_at": "2026-03-01T00:26:29.478Z"
}
```

- `template_json` mirrors `normalized_template` and is returned as a compatibility alias.

**Error responses**

- `400` missing `template_id`.
- `401` invalid API key.
- `404` template does not exist or does not belong to this API key.

### JavaScript SDK (samsar-js)

```ts

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY! });

const templateJson = await samsar.getReceiptTemplateJson(
  'receipt_tpl_0e4f9f1dca744ec9b3a3f8df',
);

console.log(templateJson.data.template_json);
```

## GET /image/status

Check the latest state for a single image request (accepts `request_id` or `session_id`).

```bash
curl "https://api.samsar.one/v1/image/status?request_id=img_enh_123" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Queued / processing**

```json
{
  "session_id": "img_enh_123",
  "request_id": "img_enh_123",
  "status": "PENDING",
  "type": "image",
  "case_type": "image_enhance"
}
```

**Completed**

```json
{
  "session_id": "img_enh_123",
  "request_id": "img_enh_123",
  "status": "COMPLETED",
  "type": "image",
  "case_type": "image_enhance",
  "result_url": "https://cdn.samsar.one/images/img_enh_123.png"
}
```

- `result_urls` is present when multiple assets are produced.
- `thumbnail_url` is included for rollup banner completions and points to a downscaled preview.
- A `404` is returned if the request does not belong to your API key or is unknown.

## GET /image/list

Fetch a list of your recent image API sessions, including their current status and any available results. Use `limit` (max 500) to trim the response.

```bash
curl "https://api.samsar.one/v1/image/list?limit=50" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Response (200)**

```json
{
  "sessions": [
    {
      "session_id": "img_rm_123",
      "request_id": "img_rm_123",
      "status": "COMPLETED",
      "type": "image",
      "case_type": "logo_remove",
      "request_type": "API",
      "result_url": "https://cdn.samsar.one/images/img_rm_123.png",
      "created_at": "2024-08-20T08:10:11.000Z",
      "updated_at": "2024-08-20T08:12:42.000Z"
    },
    {
      "session_id": "img_set_987",
      "request_id": "img_set_987",
      "status": "PENDING",
      "type": "image",
      "case_type": "image_list_to_image_set",
      "request_type": "API",
      "created_at": "2024-08-20T08:15:55.000Z",
      "updated_at": "2024-08-20T08:15:55.000Z"
    }
  ]
}
```

**Common errors**

- `400` invalid or missing fields (empty URLs, bad resolution, non-numeric `num_images`).
- `401` invalid API key.
- `402` insufficient credits.
- `404` unknown `request_id` (or a request that does not belong to the API key on `/image/status`).

## Utils

### POST /image/enhance_and_generate_rollup_banner

Enhance low-resolution tiles (if needed) and generate a rollup banner. Images below the rollup minimum (2020x2526) are auto-upscaled using `1k`/`2k`/`4k`, then the list is expanded to 28 tiles before rendering.

**Request body**

```json
{
  "images": [
    {
      "image_url": "https://cdn.example.com/tile-1.png",
      "image_text": "Rooftop Bar",
      "image_category": "Social",
      "overlay": { "top_left": "2 hours", "top_right": "City", "footer": "Rooftop Bar" }
    }
  ],
  "header_image_url": "https://cdn.example.com/header.png",
  "footer_image_url": "https://cdn.example.com/footer.png",
  "columns": 4,
  "max_tiles": 28,
  "image_tiling_position": {
    "font_key": "en",
    "font_family": "Poppins, Helvetica, Arial, sans-serif",
    "top_left": {
      "margin_min": 28,
      "margin_ratio": 0.02,
      "diameter_min": 220,
      "diameter_max": 320,
      "diameter_ratio": 0.215,
      "inner_padding_min": 12,
      "inner_padding_ratio": 0.08
    },
    "top_right": {
      "margin_min": 28,
      "margin_ratio": 0.02,
      "max_width_floor": 260,
      "min_width": 220,
      "padding_left": 36,
      "padding_right": 48,
      "padding_top": 30,
      "padding_bottom": 24,
      "overlay_height_min": 140
    },
    "bottom": {
      "inset_min": 32,
      "inset_ratio": 0.03,
      "offset_min": 12,
      "offset_ratio": 0.02,
      "container_margin_min": 40,
      "container_margin_ratio": 0.08,
      "text_inset_min": 18,
      "text_inset_ratio": 0.04,
      "overlay_height_min": 280
    }
  }
}
```

- `images` (or `image_list`/`image_urls`) required, non-empty array.
- Items accept `image_url` (or `enhanced_url`) plus optional `image_text`, `image_category`, `image_duration`, `overlay`.
- `columns` optional integer 1-6; defaults to 4.
- `max_tiles` optional integer; defaults to 28.
- `header_image_url` and `footer_image_url` optional.
- `image_tiling_position` optional object for tile overlay layout and font overrides. Omit to use defaults.

**image_tiling_position (optional)**

Overrides for per-tile overlay placement and font selection. You can send only the fields you want to change.

- `font_key` required if provided; must match a supported subtitle language key (e.g., `en`, `fr`, `es`, `ja`, `ko`, `zh-cn`, `zh-tw`, `hi`, `ar`).
- `font_family` optional; comma-separated stack. The first font must be supported for the chosen `font_key`.
- `top_left` optional object for the circular badge.
  - `margin_min`, `margin_ratio`
  - `diameter_min`, `diameter_max`, `diameter_ratio`
  - `inner_padding_min`, `inner_padding_ratio`
- `top_right` optional object for the top-right label.
  - `margin_min`, `margin_ratio`
  - `max_width_floor`, `min_width`
  - `padding_left`, `padding_right`, `padding_top`, `padding_bottom`
  - `overlay_height_min`
- `bottom` optional object for the footer label.
  - `inset_min`, `inset_ratio`
  - `offset_min`, `offset_ratio`
  - `container_margin_min`, `container_margin_ratio`
  - `text_inset_min`, `text_inset_ratio`
  - `overlay_height_min`

All `*_ratio` values are fractions between 0 and 1. Values are validated; invalid ranges return `400`.

**Success response (200)**

```json
{
  "status": "completed",
  "session_id": "rollup_enh_123",
  "request_id": "rollup_enh_123",
  "rollup_session_id": "rollup_456",
  "rollup_request_id": "rollup_456",
  "case_type": "rollup_banner_enhance",
  "result_url": "https://cdn.samsar.one/rollups/rollup_456.png",
  "thumbnail_url": "https://cdn.samsar.one/rollups/rollup_456-thumb.png",
  "result_urls": ["https://cdn.samsar.one/rollups/rollup_456.png"],
  "input_image_urls": [
    "https://cdn.example.com/tile-1-enhanced.png"
  ],
  "creditsCharged": 59,
  "remainingCredits": 4941
}
```

Poll `/image/status?request_id=rollup_enh_123` for completion. The status payload includes `case_type: rollup_banner_enhance`.
`input_image_urls` returns the enhanced URLs used for the rollup request (falls back to original URLs when no enhancement was needed), before any duplication to 28 tiles.

### POST /image/create_rollup_banner

Generate a rollup banner image from a list of tiles, with optional header/footer imagery.

**Request body**

```json
{
  "image_list": [
    {
      "image_url": "https://cdn.example.com/tile-1.png",
      "title": "Rooftop Bar",
      "image_category": "Social",
      "image_duration": "2 hours"
    },
    {
      "enhanced_url": "https://cdn.example.com/tile-2.png",
      "overlay": { "top_left": "Half day", "top_right": "Pool", "footer": "Cabana" }
    }
  ],
  "header_image_url": "https://cdn.example.com/header.png",
  "footer_image_url": "https://cdn.example.com/footer.png",
  "columns": 4,
  "max_tiles": 28,
  "image_tiling_position": {
    "font_key": "en",
    "font_family": "Poppins, Helvetica, Arial, sans-serif",
    "top_left": {
      "margin_min": 28,
      "margin_ratio": 0.02,
      "diameter_min": 220,
      "diameter_max": 320,
      "diameter_ratio": 0.215,
      "inner_padding_min": 12,
      "inner_padding_ratio": 0.08
    },
    "top_right": {
      "margin_min": 28,
      "margin_ratio": 0.02,
      "max_width_floor": 260,
      "min_width": 220,
      "padding_left": 36,
      "padding_right": 48,
      "padding_top": 30,
      "padding_bottom": 24,
      "overlay_height_min": 140
    },
    "bottom": {
      "inset_min": 32,
      "inset_ratio": 0.03,
      "offset_min": 12,
      "offset_ratio": 0.02,
      "container_margin_min": 40,
      "container_margin_ratio": 0.08,
      "text_inset_min": 18,
      "text_inset_ratio": 0.04,
      "overlay_height_min": 280
    }
  }
}
```

- `image_list` (or `images`) required, non-empty array. Each item must include `image_url` or `enhanced_url`.
- `overlay` optional; supports `top_left`, `top_right`, `footer` (fallbacks: `title`, `image_text`, `image_category`, `image_duration`).
- `columns` optional integer 1-6; defaults to 4.
- `max_tiles` optional integer; defaults to 28.
- `header_image_url` and `footer_image_url` optional.
- `image_tiling_position` optional object for tile overlay layout and font overrides. Omit to use defaults.

**image_tiling_position (optional)**

Same schema and validation as `/image/enhance_and_generate_rollup_banner`. See details above.

**Success response (200)**

```json
{
  "status": "completed",
  "session_id": "rollup_123",
  "request_id": "rollup_123",
  "result_url": "https://cdn.samsar.one/rollups/rollup_123.png",
  "thumbnail_url": "https://cdn.samsar.one/rollups/rollup_123-thumb.png",
  "result_urls": ["https://cdn.samsar.one/rollups/rollup_123.png"],
  "creditsCharged": 30,
  "remainingCredits": 4970
}
```


<a id="document-c97af5942b7fd9f32ce714fa483679ad"></a>
## Login Tokens

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/login-tokens

# Login Tokens

Use this endpoint to mint a short-lived `loginToken` from your API key. The login token can be exchanged for a long-lived client `authToken` via `/users/verify_token`.

For external platform users such as Whop members, use [`POST /external_users/create_login_token`](/external-users#post-external_userscreate_login_token) instead.

- Base URL: `https://api.samsar.one/v1`
- Auth: `Authorization: Bearer <API_KEY>`

## POST /create_login_token

Create a short-lived `loginToken` for a user associated with your API key.

**Request body**

No body is required.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/create_login_token \
  -H "Authorization: Bearer YOUR_API_KEY_****************"
```

**Success response (200)**

```json
{
  "loginToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresInSeconds": 600,
  "expiresAt": "2026-02-02T12:00:00.000Z"
}
```

**Notes**

- The token is short-lived and intended for handoff to the client app.
- `GET /create_login_token` is also supported and returns the same payload.

## Exchange login token for client auth token

Once the client receives a `loginToken`, exchange it for a long-lived `authToken` using the user verification endpoint.

**Sample request**

```bash
curl "https://api.samsar.one/users/verify_token?loginToken=$LOGIN_TOKEN"
```

**Success response (200)**

```json
{
  "authToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "_id": "...",
  "email": "user@example.com"
}
```

For external-user login tokens, the response includes `isExternalUser: true` plus the external user profile fields and the external-user-scoped `authToken`.


<a id="document-4da411b123f681c29a8467460af6dd70"></a>
## Narrative API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/narrative

# Narrative API

The Narrative API creates reusable narrative structures without starting Samsar's image, audio, or video-generation stages. Generate a singular narrative from a prompt, then optionally expand that completed narrative into a binary tree of alternate paths.

**Quick facts**

- Base URL: `https://api.samsar.one`
- Route prefix: `/v2/external/narrative`
- Authentication: `Bearer Samsar API key`
- Execution: `Asynchronous · HTTP 202 and request polling`
- Billing: `Usage-based; final charge in the status response`
- Content type: `application/json`

Use this API when you need the same validated narrative structure that a text-to-video request would build during prompt generation, but want to decide separately how or whether to render it.

## Workflow

1. Submit a narrative request and store the returned `request_id`.
2. Poll the request until its status is `COMPLETED` or `FAILED`.
3. On success, read `themeJson`, `narrativeJson`, and `movieResourceList` from the status response.
4. Optionally submit the completed singular request ID to `create_branching` and poll the new request ID for a branched resource tree.
5. When ready to render, submit either completed request ID to `POST /v2/external/video/narrative_to_video`.

Status reads are scoped to the authenticated user. Keep the same credentials for submission and polling. If the user submits another narrative while one is active, the additional accepted request remains `PENDING` until the active request reaches a terminal state.

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/v2/external/narrative/create_single` | Generate one validated narrative resource list from a prompt. |
| `POST` | `/v2/external/narrative/create_branching` | Expand a completed singular request into a validated binary narrative tree. |
| `GET` | `/v2/external/narrative/status?request_id=...` | Poll a narrative request. |
| `POST` | `/v2/external/video/narrative_to_video` | Render a completed singular or branched narrative without rerunning prompt generation. |

See [`create_single`](/narrative/create-single) to generate a singular resource list, [`create_branching`](/narrative/create-branching) to generate alternate paths, and [Render a narrative as video](/narrative/render-video) to start the media pipeline from either result.

## Returned artifacts

| Field | Description |
| --- | --- |
| `themeJson` | The generated theme data used to guide the narrative. |
| `narrativeJson` | The validated narrative before final movie-resource enrichment. |
| `movieResourceList` | A linear stage-one structure for a singular request, or a complete node-based tree for a branched request. |
| `branchingMeta` | Branched requests only: compact branch-point, leaf, and node metadata for the generated tree. |

These artifacts are stored on a standalone narrative request. Narrative creation does **not** create or modify a `VideoSession`, and it does not generate images, speech or audio files, music, or video. Both singular and branched results can later be rendered explicitly through `POST /v2/external/video/narrative_to_video`.

## Authentication

A Samsar API key is recommended:

```bash
-H "Authorization: Bearer $SAMSAR_API_KEY"
```

The API also accepts a signed Samsar user auth token. Deployments using app credentials may authenticate with `Authorization: AppKey <APP_KEY>` and `x-app-secret: <APP_SECRET>`. Missing, expired, or invalid credentials are rejected before a request is created.

## Metering

Narrative requests are usage-based. The status response reports the final customer charge in `creditsCharged` and the remaining balance in `remainingCredits`.

For `create_single`, metered work includes theme generation, narrative generation, semantic validation or repair, retries, moderation inference when billable usage is returned, and any other inference call needed to produce the final linear `movieResourceList`. For `create_branching`, it includes every divergence-planning call, child-branch generation call, and validation retry across the entire tree. Calls completed before a failed request can still be charged because that provider usage was incurred.

A positive credit balance is required before new narrative inference begins. Once a request is accepted and inference has started, its exact incurred usage is settled in full. If the final charge is greater than the balance available at submission time, `remaining_credits` can be negative; add credits before submitting more narrative work.

Terminal status responses include a `billing` object. They also include `x-credits-charged` and `x-credits-remaining` response headers when those values are available.


<a id="document-b07304693fa59961c88fbb6d04db04d4"></a>
## One platform. Every model, in context.

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/models

# One platform. Every model, in context.

Start with **hosted Samsar.js**, choose a model for your workflow, then explore the adapters available for your own deployment. Native inference and custom model endpoints have their own paths. The matrix keeps model keys, API contracts and deployment choices together.

[Get an API key](https://app.samsar.one/account/apiKeys) · [SDK quick start](/#make-your-first-request) · [Models & pricing](/pricing) · [Adapter deployment guide](/adapters)

## Inference & vision

Plan scenes, understand images, write copy and build assistants. API: https://docs.samsar.one/external-requests#chat

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GPT 6 Astra | gpt-6-astra | deployment | Managed route | OpenAI, Samsar.js, GMICloud via GenBlaze, OpenRouter | Branching | Default GPT model. Supports high and xhigh effort. Legacy gpt-5.6-sol choices still normalize to Astra; GPT 6.1 Sol is a separate choice. GenBlaze requires an exact validated mapping. API: https://docs.samsar.one/external-requests#chat |
| GPT 6.1 Sol | gpt-6.1-sol | deployment | Managed route | OpenAI, Samsar.js, OpenRouter | Branching | Supports text inference and vision with high or xhigh effort. Native OpenAI, OpenRouter, and Samsar adapters. API: https://docs.samsar.one/external-requests#chat |
| Claude Opus 5.5 | claude-opus-5.5 | deployment | Managed route | Anthropic, Samsar.js, OpenRouter | Branching | Supports text inference and vision with high or xhigh effort. Native Anthropic, OpenRouter, and Samsar adapters. API: https://docs.samsar.one/external-requests#chat |
| Claude Fable 5.1 | claude-fable-5.1 | deployment | Managed route | Anthropic, Samsar.js, OpenRouter | Branching | Supports text inference and vision with high or xhigh effort. Native Anthropic uses claude-fable-5-1; OpenRouter uses anthropic/claude-fable-5.1. API: https://docs.samsar.one/external-requests#chat |
| Gemini 4 Argon | gemini-4-argon | deployment | Managed route | Google Cloud, Samsar.js, GMICloud via GenBlaze, OpenRouter | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#chat |
| Kimi K3 | kimi-k3 (setup: KIMIK3) | deployment | Managed route | Kimi, Samsar.js | Modality-specific | Setup key KIMIK3; inference requests use kimi-k3. Native Kimi first, then Samsar; OpenRouter is not in this chain. API: https://docs.samsar.one/external-requests#chat |
| Qwen 3.8 Max | QWEN3.8 | deployment | Managed route | Alibaba Cloud, Samsar.js, GMICloud via GenBlaze, OpenRouter | Modality-specific | Native Alibaba is a Docker option. Hosted Qwen uses OpenRouter internally; callers still use Samsar.js. API: https://docs.samsar.one/external-requests#chat |
| GPT 6 Astra · extra high reasoning | gpt-6-astra-xhigh | option | Managed route | OpenAI, Samsar.js, OpenRouter | Branching | Reasoning option on GPT 6 Astra; providers receive the base model with xhigh effort. Omitted from the normal runtime catalog. API: https://docs.samsar.one/external-requests#chat |
| GPT 6.1 Sol · extra high reasoning | gpt-6.1-sol-xhigh | option | Managed route | OpenAI, Samsar.js, OpenRouter | Branching | Reasoning option on GPT 6.1 Sol; providers receive the base model with xhigh effort. Omitted from the normal runtime catalog. API: https://docs.samsar.one/external-requests#chat |
| Claude Fable 5.1 · extra high reasoning | claude-fable-5.1-xhigh | option | Managed route | Anthropic, Samsar.js, OpenRouter | Branching | Reasoning option on Claude Fable 5.1; providers receive the base model with xhigh effort. Omitted from the normal runtime catalog. API: https://docs.samsar.one/external-requests#chat |
| Claude Opus 5.5 · extra high reasoning | claude-opus-5.5-xhigh | option | Managed route | Anthropic, Samsar.js, OpenRouter | Branching | Reasoning option on Claude Opus 5.5; providers receive the base model with xhigh effort. Omitted from the normal runtime catalog. API: https://docs.samsar.one/external-requests#chat |

## Image generation

Create scene images, illustrations and reusable visual assets. API: https://docs.samsar.one/image-api#post-imagetext_to_image

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Qwen Image 3.0 Pro | QWENIMAGE3PRO | deployment | Not advertised | Alibaba Cloud | Express | Standalone native adapter only. Requires Alibaba standard pay-as-you-go credentials; Token Plan credentials do not enable it. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| GPTImage 2.6 | GPTIMAGE2.5 | deployment | Managed route | Samsar.js, OpenAI, fal | Express, Branching | Stable Samsar key for GPTImage 2.6 Sunburst. Legacy GenBlaze GPT Image 2 routes are excluded from this model. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Seedream 5 Pro | SEEDREAM | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Express | Stable key currently maps to Seedream 5 Pro. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| NanoBanana 2 | NANOBANANA2 | deployment | Managed route | Samsar.js, Google Cloud, GMICloud via GenBlaze, fal | Modality-specific | Image generation catalog model; not in the current Express image allowlist. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| NanoBanana Pro | NANOBANANAPRO | deployment | Managed route | Samsar.js, Google Cloud, GMICloud via GenBlaze, fal | Express, Branching | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Wan2.7 Pro | WAN2.7PRO | deployment | Managed route | Samsar.js, Alibaba Cloud, fal | Express | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| F-Lite | FLITE | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Google Imagen3 | IMAGEN3 | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Flux-1.1 Pro | FLUX1.1PRO | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Dall-E 3 | DALLE3 | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Flux-1 Pro | FLUX1PRO | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Flux 1.1 Ultra | FLUX1.1ULTRA | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Flux-1 Dev | FLUX1DEV | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Recraft V3 | RECRAFTV3 | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Stable Diffusion V3.5 | SDV3.5 | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Sana 4.5B | SANA4.5B | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Sana Sprint | SANASPRINT | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Recraft 20B | RECRAFT20B | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Lumalabs Photon | PHOTON | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Lumalabs Photon Flash | PHOTONFLASH | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Lumina V2 | LUMINAV2 | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Ideogram V3 | IDEOGRAMV3 | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| HiDream I1 | HIDREAMI1 | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/image-api#post-imagetext_to_image |
| Custom image endpoint | CUSTOM_TEXT_TO_IMAGE:<adapter-id> | custom | Not advertised | Custom endpoint | Modality-specific | Register a named standalone image adapter; use the exact returned key. Includes the optional Vast.ai FLUX.2 utility. API: https://docs.samsar.one/image-api#post-imagetext_to_image |

## Image editing

Edit reference images, remove objects and fill selected regions. API: https://docs.samsar.one/v2#v2-image-edit-routes

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GPTImage 2.6 Edit | GPTIMAGE2.5EDIT | deployment | Managed route | Samsar.js, OpenAI | Modality-specific | Stable Samsar key for GPTImage 2.6 Sunburst editing. Legacy GenBlaze routes are excluded. API: https://docs.samsar.one/v2#v2-image-edit-routes |
| NanoBanana 2 Edit | NANOBANANA2EDIT | deployment | Managed route | Samsar.js, Google Cloud, GMICloud via GenBlaze, fal | Modality-specific | Used by image enhancement and branding removal. Multi-output image-set jobs bypass GenBlaze. API: https://docs.samsar.one/v2#v2-image-edit-routes |
| NanoBanana Pro Edit | NANOBANANAPROEDIT | deployment | Managed route | Samsar.js, Google Cloud, GMICloud via GenBlaze, fal | Modality-specific | Required by VidGenie image-list mode. Multi-output image-set jobs bypass GenBlaze. API: https://docs.samsar.one/v2#v2-image-edit-routes |
| Bria Eraser | BRIA_ERASER | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/v2#v2-image-edit-routes |
| Bria GenFill | BRIA_GENFILL | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/v2#v2-image-edit-routes |
| Flux-1 Pro Fill | FLUX1PROFILL | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/v2#v2-image-edit-routes |
| Flux-1.1 Pro Ultra Redux | FLUX1.1PROULTRAREDUX | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/v2#v2-image-edit-routes |
| Flux-1.1 Pro Redux | FLUX1.1PROREDUX | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/v2#v2-image-edit-routes |

## Video generation

Generate motion from text, an image or first and last frames. API: https://docs.samsar.one/external-requests#video

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Runway Gen-4 | RUNWAYML | deployment | Managed route | Samsar.js, Runway | Express | Express turns planned scene images into motion. This is different from a raw text-to-video model call. API: https://docs.samsar.one/external-requests#video |
| Veo3.1 | VEO3.1 | deployment | Managed route | Samsar.js, Google Cloud, GMICloud via GenBlaze, fal | Modality-specific | Text-to-video model; the I2V variants have separate keys. API: https://docs.samsar.one/external-requests#video |
| Veo3.1 Fast | VEO3.1FAST | deployment | Managed route | Samsar.js, Google Cloud, GMICloud via GenBlaze, fal | Modality-specific | Fast text-to-video model; use VEO3.1I2VFAST for Express scene animation. API: https://docs.samsar.one/external-requests#video |
| VEO3.1 Img2Vid | VEO3.1I2V | deployment | Managed route | Samsar.js, Google Cloud, GMICloud via GenBlaze, fal | Express, Branching | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| VEO3.1 Fast Img2Vid | VEO3.1I2VFAST | deployment | Managed route | Samsar.js, Google Cloud, GMICloud via GenBlaze, fal | Express, Branching | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| VEO3.1 Frame to Video | VEO3.1FLIV | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | First/last-frame generation; not an Express video selection. API: https://docs.samsar.one/external-requests#video |
| Nvidia Cosmos 3 | COSMOS3SUPERI2V | deployment | Managed route | Samsar.js, fal | Express, Branching | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Seedance 1.5 I2V | SEEDANCEI2V | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Express | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Seedance 2.0 I2V | SEEDANCE2.0I2V | deployment | Not advertised | GMICloud via GenBlaze, fal | Express, Branching | Standalone provider-billed I2V. Exact GenBlaze route: seedance-2-0-260128. No Samsar adapter in the setup catalog. API: https://docs.samsar.one/external-requests#video |
| Seedance 2.5 I2V | SEEDANCE2.5I2V | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Express | 5, 10 or 15 second 720p scene buckets. Exact GenBlaze route: seedance-2-5-260628. Hosted worker uses GMICloud internally. API: https://docs.samsar.one/external-requests#video |
| Kling 4 I2V (legacy 3 Pro key) | KLINGIMGTOVID3PRO | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Legacy setup/request alias: new requests normalize to KLINGIMGTOVID4. Previously submitted jobs retain their saved endpoint. Registry adapters shown here do not guarantee Kling 4 availability. API: https://docs.samsar.one/external-requests#video |
| Kling 4 I2V (legacy Turbo key) | KLINGIMGTOVIDTURBO | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Legacy setup/request alias: new requests normalize to KLINGIMGTOVID4. Previously submitted jobs retain their saved endpoint. Registry adapters shown here do not guarantee Kling 4 availability. API: https://docs.samsar.one/external-requests#video |
| Kling 1.6 Pro | KLINGIMGTOVIDPRO | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Kling 2.1 Master | KLINGIMGTOVID2.1MASTER | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Kling 2.1 Pro | KLINGIMGTOVID2.1PRO | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Kling 2.1 Standard | KLINGIMGTOVID2.1STANDARD | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Hailuo 02 Pro | HAILUOPRO | deployment | Managed route | Samsar.js, GMICloud via GenBlaze, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Happy Horse 1.1 I2V | HAPPYHORSEI2V | deployment | Managed route | Samsar.js, Alibaba Cloud, GMICloud via GenBlaze, fal | Express | Stable key currently maps to Happy Horse 1.1 I2V. API: https://docs.samsar.one/external-requests#video |
| Kling 4 Img2Vid | KLINGIMGTOVID4 | studio | Not advertised | Check target Studio | Express | Kling 4 I2V: 720p, no native audio, 5, 10, 15, 20, 25, 30 second clips. Check the target deployment for adapter availability. API: https://docs.samsar.one/external-requests#video |
| Kling 4 Text2Vid | KLINGTXTTOVID4 | studio | Not advertised | Check target Studio | Modality-specific | Kling 4 T2V: 720p, no native audio, 5, 10, 15, 20, 25, 30 second clips. Direct clip generation; not an Express scene-motion selection. API: https://docs.samsar.one/external-requests#video |
| SD Video | SDVIDEO | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| Haiper 2.0 | HAIPER2.0 | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| Skyreels-i2v | SKYREELSI2V | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| Veo2 | VEO | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| Veo2 Img2Vid | VEOI2V | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| PixVerseV4.5 | PIXVERSEI2V | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| PixVerseV4.5 Fast | PIXVERSEI2VFAST | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| Pika2.2 I2V | PIKA2.2I2V | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| Magi Distilled | MAGIDISTILLED | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| Vidu Img2Vid | VIDUI2V | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#video |
| Custom video endpoint | CUSTOM_IMAGE_TO_VIDEO | custom | Not advertised | Custom endpoint | Modality-specific | Requires a compatible standalone image-to-video adapter and its configured authorization. API: https://docs.samsar.one/external-requests#video |

## Speech

Turn dialogue into narration and voice tracks. API: https://docs.samsar.one/external-requests#audio

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI Text to Speech | OPENAI (setup: OPENAI_TTS) | deployment | Managed route | Samsar.js, OpenAI, GMICloud via GenBlaze | Modality-specific | Use OPENAI in the Express tts_model field. GenBlaze speech is conditional on an exact gpt-4o-mini-tts mapping. API: https://docs.samsar.one/external-requests#audio |
| Google Text to Speech | GOOGLE (setup: GOOGLE_TTS) | deployment | Managed route | Samsar.js, Google Cloud | Modality-specific | Use GOOGLE in the Express tts_model field. API: https://docs.samsar.one/external-requests#audio |
| ElevenLabs Speech | ELEVENLABS | deployment | Managed route | fal | Modality-specific | Hosted audio accepts ELEVENLABS. The standalone setup registry enables this speech model through fal only. API: https://docs.samsar.one/external-requests#audio |
| PlayAI speech | PLAYAI | service | Managed route | Samsar.js | Modality-specific | Accepted by the hosted audio speech contract. Not advertised by the standalone setup matrix. API: https://docs.samsar.one/external-requests#audio |

## Music

Generate a backing track for your video or an audio asset. API: https://docs.samsar.one/external-requests#audio

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Lyria 3 | LYRIA3 | deployment | Managed route | Samsar.js, Google Cloud, fal | Modality-specific | Google music credential validation can change the runtime order between Google and fal. API: https://docs.samsar.one/external-requests#audio |
| ElevenLabs Music | ELEVENLABS_MUSIC | deployment | Managed route | Samsar.js, ElevenLabs, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#audio |
| AudioCraft | AUDIOCRAFT | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#audio |
| Cassette AI | CASSETTEAI | studio | Not advertised | Check target Studio | Modality-specific | Listed in the Studio source catalog, outside the standalone setup matrix. Workflow scope follows the source allowlists; adapter availability depends on the target deployment. API: https://docs.samsar.one/external-requests#audio |
| Custom music endpoint | CUSTOM_TEXT_TO_MUSIC | custom | Not advertised | Custom endpoint | Modality-specific | Requires a compatible configured text-to-music endpoint. API: https://docs.samsar.one/external-requests#audio |

## Lip sync

Match a visible speaker to a supplied audio track. API: https://docs.samsar.one/external-requests#video

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Sync Lip Sync | SYNCLIPSYNC | deployment | Managed route | Samsar.js, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| LatentSync | LATENTSYNC | deployment | Managed route | Samsar.js, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Kling Lip Sync | KLINGLIPSYNC | deployment | Managed route | Samsar.js, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Hummingbird Lip Sync | HUMMINGBIRDLIPSYNC | deployment | Managed route | Samsar.js, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |
| Creatify Lip Sync | CREATIFYLIPSYNC | deployment | Managed route | Samsar.js, fal | Modality-specific | Enable a supported adapter and check the target deployment before selecting this model. API: https://docs.samsar.one/external-requests#video |

## Sound effects

Add sound to an existing video or generate an audio effect. API: https://docs.samsar.one/external-requests#video

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| MMAudio V2 | MMAUDIOV2 | deployment | Managed route | Samsar.js, fal | Modality-specific | Video-conditioned sound. This is separate from the audio-only SDAUDIO route. API: https://docs.samsar.one/external-requests#video |
| Mirelo AI | MIRELOAI | deployment | Managed route | Samsar.js, fal | Modality-specific | Video-conditioned sound. Provide a video URL and the desired sound prompt. API: https://docs.samsar.one/external-requests#video |
| Audio sound effects | SDAUDIO | service | Managed route | Samsar.js | Modality-specific | Hosted text-to-sound-effect audio route. Different from video-conditioned MMAudio and Mirelo. API: https://docs.samsar.one/external-requests#audio |

## Embeddings & search

Index content for semantic search and recommendations. API: https://docs.samsar.one/chat-api#post-chatcreate_embedding

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI embeddings | text-embedding-3-large | service | Managed route | Samsar.js, OpenAI | Modality-specific | Hosted search is accessed through Samsar.js. Local indexing still requires OPENAI_API_KEY; crawling URLs also requires FIRECRAWL_API_KEY. API: https://docs.samsar.one/chat-api#post-chatcreate_embedding |

## Transcription

Align speech with text for transcripts and subtitles. API: https://docs.samsar.one/external-requests#audio

| Model | Request key | Scope | Hosted Samsar | Adapters | Workflow | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Whisper transcript alignment | whisper-1 | service | Managed route | Samsar.js, OpenAI | Modality-specific | Managed transcript-alignment route; not a freely selectable Express inference model. API: https://docs.samsar.one/external-requests#audio |

## How to read the matrix

- **Samsar.js** is the client for Samsar APIs. With the default hosted URL, your request is handled by Samsar; you do not need to configure each upstream provider.
- **Deployment adapters** list compatible integrations from the setup registry. Samsar.js leads media documentation; native inference adapters may appear first. This display order does not change fallback behavior.
- **Express** marks models in the source allowlists for text-to-video and image-list-to-video. **Branching** marks the narrower narrative allowlists. Check the deployment response before submitting.
- **Studio catalog** entries appear in the source catalog but are outside the standalone setup matrix. They are not a promise of a live hosted route.
- **Custom endpoint** entries require local configuration. **Managed service** entries describe operation-specific APIs such as search, speech and transcript alignment.

The Express `tts_model` values are `OPENAI`, `GOOGLE` and `ELEVENLABS`; setup labels such as `OPENAI_TTS` are not interchangeable with every endpoint field. Similarly, `KIMIK3` is the setup key and `kimi-k3` is the inference request value. Use the linked API contract for the exact payload.

## Check the target deployment

```js title="Inspect hosted Express model availability with samsar-js"

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const available = await samsar.getSupportedTextToVideoModels();
console.log(available.data);
```

This endpoint covers Express workflows. It is not an inventory of every Studio or audio model. In a standalone deployment, also inspect `runtime/config/available-models.json` and **Settings → Model Adapters**. GenBlaze exposes only the exact routes validated for your GMICloud credential.

The matrix is generated from the Samsar setup registry, processor catalogs and workflow allowlists. It is a documented capability snapshot, not a live provider status page. See the [source matrix and maintenance instructions](https://github.com/samsarone/samsar/blob/main/pages/model-matrix.md).


<a id="document-341374514279d81a89be75dd68fe80a1"></a>
## Publications API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/publications

# Publications API

**Quick facts**

- Base URL: `https://api.samsar.one/v1`
- Route prefix: `/publications`
- Authentication: `Bearer API key/auth token, or customer sub-account key`
- Execution: `Synchronous publication controls`
- Billing: `No additional charge for CRUD and archive`
- Content type: `application/json`

Use these endpoints when an external application needs to publish, edit, or revoke a public publication for a completed `samsar-js` video session. The authenticated account must own the target video session. A singular session needs its final video URL; a branched session needs every path render finalized.

Singular sessions create the existing single-video `Publication`. A finalized branched session creates an `InteractivePublication` instead. Interactive publication output contains only the public path videos, a first-frame thumbnail for every path, and the media-relative choice graph needed by an interactive player; it does not contain generation diagnostics or billing data.

## Publication fields

Samsar infers the final video URL and many defaults from the session. Send the fields your app owns or cannot infer from the session:

```json
{
  "session_id": "66ff...",
  "title": "Running shoe teaser",
  "description": "Launch-day vertical cut",
  "tags": ["launch", "footwear"],
  "creator_handle": "acme",
  "slug": "running-shoe-teaser",
  "image_hash": "optional-image-hash",
  "splash_image": "https://cdn.example.com/splash.png",
  "image_model": "GPTIMAGE2.5",
  "video_model": "RUNWAYML",
  "original_prompt": "A fast launch video for a new running shoe",
  "aspect_ratio": "9:16",
  "has_subtitles": true,
  "session_language": "en",
  "language_string": "English"
}
```

Alias support:

- `session_id`, `sessionId`, `video_session_id`, `videoSessionId`, or `id`
- `aspect_ratio` or `aspectRatio`
- `creator_handle` or `creatorHandle`
- `image_hash` or `imageHash`
- `splash_image` or `splashImage`
- `image_model` or `imageModel`
- `video_model` or `videoModel`
- `original_prompt`, `originalPrompt`, or `prompt`
- `session_language`, `sessionLanguage`, `language`, or `language_code`
- `language_string` or `languageString`
- `has_subtitles`, `hasSubtitles`, `enable_subtitles`, or `enableSubtitles`

Request bodies can be sent flat or nested under `input`.

## POST /publications/publish

Create or update a public publication for a completed session.

```bash
curl -X POST https://api.samsar.one/v1/publications/publish \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "66ff...",
    "title": "Running shoe teaser",
    "description": "Launch-day vertical cut",
    "tags": ["launch", "footwear"],
    "creator_handle": "acme"
  }'
```

Success response:

```json
{
  "created": true,
  "publication": {
    "publication_id": "67aa...",
    "session_id": "66ff...",
    "video_url": "https://static.samsar.one/video/66ff/final.mp4",
    "title": "Running shoe teaser",
    "description": "Launch-day vertical cut",
    "tags": ["launch", "footwear"],
    "creator_handle": "acme",
    "aspect_ratio": "9:16",
    "has_subtitles": true,
    "language": "en",
    "session_language": "en",
    "language_string": "English"
  },
  "session": {
    "session_id": "66ff...",
    "is_published": true,
    "published_publication_id": "67aa...",
    "published_video_url": "https://static.samsar.one/video/66ff/final.mp4"
  }
}
```

## POST /publications/edit

Edit an existing publication for a session. Omitted fields keep their current publication values.

```bash
curl -X POST https://api.samsar.one/v1/publications/edit \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "66ff...",
    "title": "Running shoe teaser - updated",
    "tags": ["launch", "footwear", "campaign"]
  }'
```

`404` is returned when the session exists but has no publication yet.

## POST /publications/revoke

Remove a session publication from the public feed and clear the published fields on the session.

```bash
curl -X POST https://api.samsar.one/v1/publications/revoke \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "66ff..."
  }'
```

Success response:

```json
{
  "revoked": true,
  "publication_id": "67aa...",
  "session": {
    "session_id": "66ff...",
    "is_published": false
  }
}
```

## REST aliases

The same operations are also available as session-centric routes:

- `POST /publications/session/:sessionId`
- `PATCH /publications/session/:sessionId`
- `DELETE /publications/session/:sessionId`

## Public interactive publication feed

These read routes are unauthenticated and free:

- `GET https://api.samsar.one/interactive_publications`
- `GET https://api.samsar.one/interactive_publications/:publicationId`
- Versioned aliases are available under `/v1/interactive_publications`.

The list supports `limit` (default `50`, maximum `200`) and an opaque `cursor` returned by the previous page:

```bash
curl "https://api.samsar.one/interactive_publications?limit=20"
```

```json
{
  "items": [{
    "id": "67ab...",
    "type": "InteractiveVideo",
    "schema": "interactive_publication.v1",
    "title": "Fork in the road",
    "description": "Choose the hero's next move.",
    "tags": ["interactive", "adventure"],
    "creatorHandle": "acme",
    "datePublished": "2026-07-19T00:00:00.000Z",
    "thumbnailUrl": "https://static.samsar.one/published/66ff/interactive/revisions/8f4d.../paths/cm9vdC4x/thumbnail.png",
    "aspectRatio": "16:9",
    "inLanguage": "en",
    "hasSubtitles": true,
    "manifest": {
      "schema": "interactive_video_manifest.v1",
      "default_path_id": "root.1",
      "timing": {
        "origin": "media",
        "unit": "seconds"
      },
      "tree": {
        "root_node_id": "root",
        "choice_points": [{
          "branch_point_id": "choice-root",
          "parent_node_id": "root",
          "switch_at_seconds": 8,
          "options": [{
            "child_node_id": "root.1",
            "path_name": "Open the door",
            "path_description": "Continue through the doorway.",
            "leaf_path_ids": ["root.1"]
          }]
        }]
      },
      "outputs": {
        "paths": [{
          "path_id": "root.1",
          "contentUrl": "https://static.samsar.one/published/66ff/interactive/revisions/8f4d.../paths/cm9vdC4x/video.mp4",
          "thumbnailUrl": "https://static.samsar.one/published/66ff/interactive/revisions/8f4d.../paths/cm9vdC4x/thumbnail.png",
          "encodingFormat": "video/mp4",
          "duration": 24,
          "is_default": true
        }]
      }
    }
  }],
  "nextCursor": null,
  "hasMore": false,
  "totalCount": 1
}
```

The `timing`, `tree`, and `outputs.paths` layout follows the completed branched response from `status_detailed`, so clients can reuse the same choice-graph logic. `contentUrl`, `thumbnailUrl`, and `encodingFormat` use standard media-resource field names. `duration` and `switch_at_seconds` are media-relative seconds. A publication is withheld if any path video or thumbnail is unavailable publicly; clients never receive a partial choice graph.

## Error responses

- `400` missing or invalid `session_id`
- `401` invalid API key, customer sub-account key, or auth token
- `403` the session does not belong to the authenticated actor
- `404` session or publication not found
- `409` the session has no final video URL yet

## samsar-js

```ts

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY! });

await samsar.publishPublication({
  session_id: '66ff...',
  title: 'Running shoe teaser',
  tags: ['launch', 'footwear'],
});

await samsar.editPublication({
  session_id: '66ff...',
  title: 'Running shoe teaser - updated',
});

await samsar.revokePublication('66ff...');

const page = await samsar.listInteractivePublications({ limit: 20 });
const interactivePublication = await samsar.getInteractivePublication(page.data.items[0].id);
```


<a id="document-0e279fdfc97ca1d26e57ba82eb3cce8b"></a>
## Render a narrative as video

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/narrative/render-video

# Render a narrative as video

`POST /v2/external/video/narrative_to_video`

Start an express video from a completed `NarrativeRequest`. Samsar copies the stored `themeJson`, `narrativeJson`, and `movieResourceList` into a new `VideoSession`, skips prompt generation, and continues with image, speech, music, AI-video, frame, and final-video generation.

The source can be `narrative_type: "singular"` or `narrative_type: "branched"`. The source request is never modified.

## Request body

```json
{
  "input": {
    "narrative_request_id": "687b4127b503e2b4acdf9876",
    "image_model": "GPTIMAGE2.5",
    "video_model": "RUNWAYML"
  },
  "webhookUrl": "https://example.com/webhooks/video"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `narrative_request_id` | string | Yes | Owned, completed singular or branched `NarrativeRequest` ID. |
| `image_model` | string | No | Express image-model override. The authenticated user's configured default is used when omitted. |
| `video_model` | string | No | Express video-model override. The authenticated user's configured default is used when omitted. |
| `webhookUrl` | string | No | Top-level URL that receives one terminal session webhook. |

The ID aliases `narrativeRequestId`, `session_id`, `sessionId`, `request_id`, and `requestId` are accepted. Model aliases may be camel-cased. Do not provide `prompt` or `duration`; both are inherited from the source request and overrides are rejected.

## Submit and poll

```bash
curl -X POST "https://api.samsar.one/v2/external/video/narrative_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "narrative_request_id": "687b4127b503e2b4acdf9876"
    }
  }'
```

HTTP `200` returns the new video request ID:

```json
{
  "request_id": "687b4d244d7798b1fbec0123",
  "session_id": "687b4d244d7798b1fbec0123",
  "source_narrative_request_id": "687b4127b503e2b4acdf9876",
  "status": "PENDING"
}
```

Poll the video route, not the narrative status route:

```bash
curl "https://api.samsar.one/v2/external/video/status?request_id=687b4d244d7798b1fbec0123" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

## Branch rendering

For a singular source, the session follows the existing linear pipeline and returns one video.

For a branched source, each leaf node is a complete linear viewing path. Samsar generates shared image, speech, music, and scene-video assets once, then generates path-specific frames and one final video for every leaf. A tree with `num_levels: 2` therefore returns four videos.

### Compact branch status

The normal status response includes a normalized `branching` manifest with schema `branched_video_status.v1`. It is compact enough for regular polling: it contains tree choices, path-level frame and video status, aggregate progress, and completed path URLs, but it does not contain rendered frame lists or duplicate the shared media assets.

The example below shows one path waiting for final video generation while its sibling is still generating frames:

```json
{
  "request_id": "687b4d244d7798b1fbec0123",
  "session_id": "687b4d244d7798b1fbec0123",
  "status": "PENDING",
  "narrative_type": "branched",
  "render_plan_version": 1,
  "default_path_id": "root.1",
  "branching": {
    "schema": "branched_video_status.v1",
    "status": "PENDING",
    "is_complete": false,
    "finalized": false,
    "render_plan_version": 1,
    "default_path_id": "root.1",
    "summary": {
      "total_paths": 2,
      "completed_paths": 0,
      "pending_paths": 2,
      "failed_paths": 0,
      "cancelled_paths": 0,
      "frame_paths_completed": 1,
      "video_paths_completed": 0,
      "progress_percent": 25
    },
    "tree": {
      "root_node_id": "root",
      "num_levels": 1,
      "branching_factor": 2,
      "node_count": 3,
      "leaf_node_ids": ["root.1", "root.2"],
      "branch_scene_indices": [2],
      "choice_points": [
        {
          "branch_point_id": "branch-point:root",
          "parent_node_id": "root",
          "level": 1,
          "divergence_scene_index": 2,
          "switch_at_seconds": 15,
          "options": [
            {
              "child_node_id": "root.1",
              "branch_ordinal": 1,
              "path_name": "Follow the signal",
              "path_description": "Trace the mysterious broadcast to its source.",
              "leaf_path_ids": ["root.1"]
            },
            {
              "child_node_id": "root.2",
              "branch_ordinal": 2,
              "path_name": "Shut it down",
              "path_description": "Destroy the receiver before the signal spreads.",
              "leaf_path_ids": ["root.2"]
            }
          ]
        }
      ]
    },
    "paths": [
      {
        "path_id": "root.1",
        "leaf_node_id": "root.1",
        "ordinal": 0,
        "is_default": true,
        "node_ids": ["root", "root.1"],
        "duration": 60,
        "status": "PENDING",
        "current_stage": "video_generation",
        "stages": {
          "frame_generation": "COMPLETED",
          "video_generation": "PENDING"
        },
        "stage_details": {
          "frame_generation": {
            "status": "COMPLETED",
            "pending": false
          },
          "video_generation": {
            "status": "PENDING",
            "pending": true
          }
        },
        "selection_trail": [
          {
            "branch_point_id": "branch-point:root",
            "node_id": "root.1",
            "parent_node_id": "root",
            "level": 1,
            "divergence_scene_index": 2,
            "switch_at_seconds": 15,
            "path_name": "Follow the signal"
          }
        ]
      },
      {
        "path_id": "root.2",
        "leaf_node_id": "root.2",
        "ordinal": 1,
        "is_default": false,
        "node_ids": ["root", "root.2"],
        "duration": 60,
        "status": "PENDING",
        "current_stage": "frame_generation",
        "stages": {
          "frame_generation": "PENDING",
          "video_generation": "INIT"
        }
      }
    ],
    "outputs": {
      "ready": false,
      "default_path_id": "root.1"
    }
  }
}
```

`branching.summary.progress_percent` describes the path-specific frame/final-video fan-out. The shared image, speech, music, and scene-video stages remain available in `expressGenerationStatus`. Each `branching.paths[]` entry reports its own `current_stage`, normalized `stages`, and detailed pending/error state.

### Detailed branch preview

Use `status_detailed` when the client needs to preview a path before all final videos are ready:

```bash
curl "https://api.samsar.one/v2/external/video/status_detailed?request_id=687b4d244d7798b1fbec0123" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

The response includes the detailed manifest at both top-level `branching` and `session.branching`. Both copies add normalized path timelines:

```json
{
  "status_detail_schema": "video_session_preview.v1",
  "session": {
    "layers": [
      {
        "id": "687b4e1a4d7798b1fbec1001",
        "startTime": 0,
        "endTime": 5,
        "duration": 5,
        "preview": {
          "stage": "ai_video_generation",
          "type": "video",
          "url": "https://cdn.example.com/shared-scene-1.mp4"
        }
      }
    ],
    "audioLayers": [
      {
        "id": "687b4e1a4d7798b1fbec2001",
        "type": "speech",
        "status": "COMPLETED",
        "startTime": 0,
        "endTime": 5,
        "duration": 5,
        "url": "https://cdn.example.com/shared-scene-1.mp3"
      }
    ],
    "branching": {
      "schema": "branched_video_status.v1",
      "default_path_id": "root.1",
      "paths": [
        {
          "path_id": "root.1",
          "timeline": [
            {
              "sequence_index": 0,
              "scene_index": 0,
              "layer_id": "687b4e1a4d7798b1fbec1001",
              "start_time": 0,
              "end_time": 5,
              "duration": 5,
              "frame_generation": {
                "status": "COMPLETED",
                "pending": false
              }
            }
          ],
          "audio_timeline": [
            {
              "sequence_index": 0,
              "audio_layer_id": "687b4e1a4d7798b1fbec2001",
              "connected_layer_id": "687b4e1a4d7798b1fbec1001",
              "start_time": 0,
              "end_time": 5,
              "duration": 5
            }
          ]
        }
      ]
    }
  }
}
```

The media catalog is normalized: `session.layers` and `session.audioLayers` contain each generated asset once, while every path timeline refers to those assets by `layer_id` or `audio_layer_id`. Build an ID lookup table, walk the selected path's timeline in `sequence_index` order, and resolve each reference to its current `preview` asset. The API intentionally omits internal rendered-frame arrays from polling responses.

### Final outputs and interactive switching

A branched request reaches top-level `status: "COMPLETED"` only when every required leaf path has a completed final render and URL. At that point:

- `result_url` is the deterministic default-path video, preserving the singular-video contract.
- `result_urls` contains every leaf video in stable path order.
- `branching.outputs.ready` is `true`, and `branching.outputs.paths` maps each `path_id` to its URL.
- `branch_results` remains available as a compact compatibility alias for existing clients.

Selected terminal fields look like this:

```json
{
  "status": "COMPLETED",
  "narrative_type": "branched",
  "default_path_id": "root.1",
  "result_url": "https://cdn.example.com/root.1.mp4",
  "result_urls": [
    "https://cdn.example.com/root.1.mp4",
    "https://cdn.example.com/root.2.mp4"
  ],
  "branch_results": [
    {
      "path_id": "root.1",
      "leaf_node_id": "root.1",
      "ordinal": 0,
      "status": "COMPLETED",
      "result_url": "https://cdn.example.com/root.1.mp4"
    },
    {
      "path_id": "root.2",
      "leaf_node_id": "root.2",
      "ordinal": 1,
      "status": "COMPLETED",
      "result_url": "https://cdn.example.com/root.2.mp4"
    }
  ],
  "branching": {
    "schema": "branched_video_status.v1",
    "status": "COMPLETED",
    "is_complete": true,
    "finalized": true,
    "default_path_id": "root.1",
    "summary": {
      "total_paths": 2,
      "completed_paths": 2,
      "pending_paths": 0,
      "failed_paths": 0,
      "frame_paths_completed": 2,
      "video_paths_completed": 2,
      "progress_percent": 100
    },
    "outputs": {
      "ready": true,
      "default_path_id": "root.1",
      "default_url": "https://cdn.example.com/root.1.mp4",
      "paths": [
        {
          "path_id": "root.1",
          "leaf_node_id": "root.1",
          "ordinal": 0,
          "is_default": true,
          "url": "https://cdn.example.com/root.1.mp4"
        },
        {
          "path_id": "root.2",
          "leaf_node_id": "root.2",
          "ordinal": 1,
          "is_default": false,
          "url": "https://cdn.example.com/root.2.mp4"
        }
      ]
    }
  }
}
```

For an interactive player, show a choice when playback reaches `tree.choice_points[].switch_at_seconds`. Each option supplies the descendant `leaf_path_ids`; use successive choices to narrow the candidate set to one leaf output. The matching path's `selection_trail` records the exact ordered choices and switch times. Because every leaf video preserves its shared parent prefix, the client can switch to the selected leaf video at the same playback time.

If any required path fails, the aggregate request is `FAILED`. Completed sibling URLs remain visible on their path entries and in legacy `branch_results` for diagnosis or recovery, but `branching.outputs.ready` remains `false` and the top-level terminal `result_urls` set is not published as complete.

When `webhookUrl` is configured, the terminal success webhook and the persisted external-request response include the same compact `branching`, `branch_results`, `default_path_id`, and ordered `result_urls` fields. Failure webhooks include the normalized branch state for diagnosis but never publish the aggregate `result_urls` set; that set is reserved for successful full completion. For external requests, webhook `request_id` and `session_id` contain the public `extreq_...` ID; `upstream_session_id` contains the internal `VideoSession` ID for server-side correlation.

## samsar-js

```ts
const queued = await samsar.createExternalVideoFromNarrative({
  narrative_request_id: '687b4127b503e2b4acdf9876',
  image_model: 'GPTIMAGE2.5',
  video_model: 'RUNWAYML',
});

const status = await samsar.getV2ExternalVideoStatus(
  queued.data.request_id,
);

const manifest = status.data.branching;
for (const path of manifest?.paths ?? []) {
  console.log(path.path_id, path.current_stage, path.result_url);
}

const detailed = await samsar.getV2ExternalVideoStatusDetailed(
  queued.data.request_id,
);

const previewManifest = detailed.data.session?.branching;
const selectedPath = previewManifest?.paths.find(
  (path) => path.path_id === previewManifest.default_path_id,
);
```

Clients that have not adopted the normalized manifest can continue reading `branch_results`, `result_url`, and `result_urls`. Singular video responses retain their existing shape and do not require branch-aware handling.

## Validation and billing

The source must belong to the authenticated user, be terminally successful, have settled narrative billing, and contain valid stored artifacts. Branched sources are revalidated as narrative trees before media work starts.

Narrative inference is not run or billed again. The new `VideoSession` is billed at the selected model's full express-render unit price. A singular request uses its linear playback duration. A branched request instead uses the cumulative duration of the normalized layer catalog:

```text
branched render credits = selected model unit price × cumulative unique layer duration
```

Shared parent layers count once, every divergent and leaf-only layer counts once, and a shared outro counts once. Complete leaf-path durations are not added together, so rendering multiple leaf videos does not repeatedly bill their shared prefixes. Samsar fixes this cumulative duration when it materializes the canonical layer catalog; later speech or video timing adjustments can change playback timing but do not make different pipeline stages use different billing durations. Optional express add-ons remain separately billable when selected.


<a id="document-a6fd7f8d3bcb83a74ed791a7ca6d290b"></a>
## V2 API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/v2

# V2 API

Start with hosted **samsar-js**, use the [model matrix](/models) to compare capabilities, and follow the [adapter guide](/adapters) for standalone deployments. The route map below preserves the API-specific request contracts.

**Quick facts**

- Base URL: `https://api.samsar.one`
- Route prefix: `/v2 · alias /api/v2`
- Authentication: `Internal, app-key, or external-user actor`
- Execution: `Unified synchronous and asynchronous workflows`
- Billing: `Delegates to the canonical route's existing billing rules`
- Content type: `application/json`

`/v2` is an additive API surface. `/v1` is not deprecated. The same router is also available under `/api/v2` for clients that use the longer API prefix.

The `/v2` routes are designed for clients where either an internal Samsar account or an external user can be authenticated in the same UI. Each route resolves the authenticated actor and routes the request through the existing internal or external-user handling path so the same validation, pricing, and credit deduction rules continue to apply.

## Route map

The tables favor canonical paths. Compatibility aliases are called out only when they are useful during a migration; use the endpoint sections below for request contracts and status behavior.

### Core session and request routes

| Route | Purpose |
| --- | --- |
| `GET /v2/health` | Check V2 service health without authentication. |
| `POST /v2/session` | Create a V2 session. |
| `POST /v2/create_login_token` | Create a login token for authenticated flows. |
| `GET /v2/requests` | List requests visible to the authenticated actor. |
| `GET /v2/status` | Poll request or session status. |
| `GET /v2/status_detailed` | Poll status plus normalized video-session preview data. |
| `POST /v2/status_detailed` | POST alias for detailed status checks. |

### Credits and billing routes

| Route | Purpose |
| --- | --- |
| `GET /v2/credits` | Fetch resolved actor credits. |
| `POST /v2/credits/recharge` | Create an internal recharge flow. |
| `POST /v2/credits/grant` | Administrator-only manual credit grant to an external user. |
| `GET /v2/payment_status` | Fetch payment status for a resolved actor. |
| `POST /v2/payment_status` | Check payment status with a request body. |

### User account routes

| Route | Purpose |
| --- | --- |
| `POST /v2/user/recharge_credits` | Create or top up a Samsar user by email. |
| `GET /v2/user/recharge_credits` | GET alias for user credit recharge. |
| `POST /v2/user/create_external_user` | Create or update an external user mapped to the authenticated internal user. |
| `POST /v2/user/refresh_token` | Rotate a user refresh token. |
| `GET /v2/user/refresh_token` | GET alias for user refresh token rotation. |
| `GET /v2/user/credits` | Fetch authenticated user credits. |
| `GET /v2/user/usage/logs` | Fetch authenticated user usage logs. |
| `GET /v2/user/payment_status` | Fetch user payment status. |
| `POST /v2/user/payment_status` | Check user payment status with a request body. |

### App key routes

| Route | Purpose |
| --- | --- |
| `POST /v2/users/app_key` | Create a long-running app key. |
| `GET /v2/users/app_key` | Fetch active app key metadata. |
| `DELETE /v2/users/app_key` | Revoke the active app key. |
| `POST /v2/users/app_key/refresh` | Rotate an app key. |
| `GET /v2/users/app_key/refresh` | GET alias for app key rotation. |

### Assistant and utility routes

| Route | Purpose |
| --- | --- |
| `POST /v2/assistant/set_system_prompt` | Set an assistant system prompt. |
| `POST /v2/assistant/completion` | Create an assistant completion. |
| `POST /v2/external/chat` | Create an OpenAI-compatible external inference completion. |
| `POST /v2/external/chat/completions` | Alias for external inference completions. |
| `POST /v2/external/assistant` | Assistant-named alias for external chat completions. |
| `POST /v2/external/assistant/completions` | Assistant-named OpenAI-compatible completion alias. |
| `GET /v2/external/chat/status` | Poll an external assistant request by `request_id` or `client_request_id`. |
| `GET /v2/external/chat/completions/status` | Status alias for external assistant requests. |
| `GET /v2/external/assistant/status` | Assistant-named status alias. |
| `POST /v2/external/moderation` | Create a no-charge external moderation check. |
| `POST /v2/external/moderations` | Alias for external moderation checks. |
| `GET /v2/external/api_key/validate` | Validate a Samsar provider API key. |
| `GET /v2/external/providers/capabilities` | Read provider, model, and action capabilities. |
| `POST /v2/external/providers/validate` | Validate deployment provider credentials. |
| `POST /v2/external/narrative/create_single` | Create a singular structured narrative. |
| `POST /v2/external/narrative/create_branching` | Create a branching structured narrative. |
| `GET /v2/external/narrative/status` | Poll a singular or branching narrative request. |
| `POST /v2/external/audio/text_to_speech` | Create hosted speech for 1 credit/request. |
| `POST /v2/external/audio/text_to_music` | Create an API-key billed hosted text-to-music request. |
| `POST /v2/external/audio/text_to_sound_effect` | Create a hosted sound effect for 1 credit/request. |
| `POST /v2/external/audio/transcript_align` | Align transcript audio with usage-based per-minute billing. |
| `GET /v2/external/audio/status` | Poll hosted external audio request status. |
| `POST /v2/external/embeddings` | Create 1536-dimension external embeddings with `text-embedding-3-small`. |
| `POST /v2/external/image/text_to_image` | Generate hosted images; `/generate` and `/generations` are aliases. |
| `POST /v2/external/image/assign_title` | Generate an image title with usage-based billing. |
| `POST /v2/external/image/enhance` | Enhance a hosted image. |
| `POST /v2/external/image/remove_branding` | Remove branding from a hosted image. |
| `POST /v2/external/image/add_image_set` | Extend a hosted image set. |
| `GET /v2/external/image/status` | Poll a hosted image request. |
| `POST /v2/utils/assistant_session` | Create or resolve an assistant session. |
| `POST /v2/utils/usage_charge` | Apply a usage charge. |
| `POST /v2/generate_embeddings_from_plain_text` | Create embeddings from cleaned plain text. |

### Media generation routes

| Route | Purpose |
| --- | --- |
| `POST /v2/upload_image_data` | Upload image data for later generation routes. |
| `POST /v2/image/assign_title` | Assign a short SEO-friendly image title. Returns `{ "content": "..." }` synchronously and uses usage-based credits. |
| `POST /v2/images/assign_title` | Alias for `POST /v2/image/assign_title`. |
| `POST /v2/image/enhance` | Enhance or upscale an image using the same pricing as `/v1/image/enhance`. |
| `POST /v2/image/remove_branding` | Remove watermark, logo, or brand text using the same pricing as `/v1/image/remove_branding`. |
| `POST /v2/image/add_image_set` | Extend an image set using the same pricing as `/v1/image/add_image_set`. |
| `POST /v2/image/text_to_image` | Generate images at the selected model rates, charged on completion. |
| `POST /v2/text_to_video` | Create a video from text input. |
| `POST /v2/image_list_to_video` | Create a video from image URLs. |
| `POST /v2/video/step/text_to_video` | Create a step-controlled text-to-video request. |
| `POST /v2/video/step/image_to_video` | Create a step-controlled image-to-video request. |
| `POST /v2/video/step/lip_sync` | Create a step-controlled lip-sync request. |
| `POST /v2/video/step/sound_effect` | Create a step-controlled sound-effect request. |
| `GET /v2/video/step/:request_id/status` | Poll step-controlled request status and completed resources. |
| `GET /v2/video/step/:request_id/status_detailed` | Poll step status plus normalized preview data for completed media. |
| `POST /v2/video/step/:request_id/status_detailed` | POST alias for detailed step status checks. |
| `POST /v2/video/step/:request_id/process_next` | Continue a completed step-controlled request to the next stage. |
| `POST /v2/external/video/text_to_video` | Create an API-key billed hosted text-to-video request for remote deployments. |
| `POST /v2/external/video/image_to_video` | Create an API-key billed hosted image-to-video request for remote deployments. |
| `POST /v2/external/video/direct_image_to_video` | Generate hosted video directly from a public image URL. |
| `POST /v2/external/video/narrative_to_video` | Start hosted media generation from a completed singular or branched NarrativeRequest. |
| `POST /v2/external/video/lip_sync` | Create an API-key billed hosted lip-sync request from public media URLs. |
| `POST /v2/external/video/sound_effect` | Create an API-key billed hosted sound-effect request from a public video URL. |
| `GET /v2/external/video/status` | Poll hosted external video request status. |
| `GET /v2/external/video/status_detailed` | Poll hosted external video detailed status and preview data. |
| `POST /v2/text_to_interactive_video` | Generate an interactive video workflow. |
| `POST /v2/external/video/text_to_interactive_video` | External-provider alias for interactive video generation. |
| `POST /v2/text_to_interactive_video/session` | Create an interactive-video draft session. |
| `POST /v2/translate_video` | Translate an existing video. |
| `POST /v2/retranslate_video` | Alias for translating an existing video. |
| `POST /v2/add_outro_image` | Add an outro image to an existing video. |
| `POST /v2/update_outro_image` | Update an existing outro image. |
| `POST /v2/update_footer_image` | Update or remove an existing video footer CTA. |
| `POST /v2/add_subtitles` | Add subtitles; `/v2/video/add_subtitles` is an alias. |
| `POST /v2/remove_subtitles` | Remove subtitles; `/v2/video/remove_subtitles` is an alias. |
| `POST /v2/join_videos` | Join videos into one output. |
| `POST /v2/video/clone` | Deep-copy a completed video session and render a new final video URL. |
| `POST /v2/regenerate_avatar` | Regenerate the narrator avatar; `/v2/video/regenerate_avatar` is an alias. |
| `POST /v2/reroll-layers` | Reroll selected 1-based layers from image generation, then rerender the session. |
| `POST /v2/video/reroll-layers` | Alias for `POST /v2/reroll-layers`. |
| `POST /v2/cancel_render` | Cancel active render work. |
| `POST /v2/pause_render` | Pause active render work. |
| `POST /v2/resume_render` | Resume paused render work. |

### Publishing routes

| Route | Purpose |
| --- | --- |
| `POST /v2/archive` | Archive a generated asset. |
| `POST /v2/publish` | Publish a generated asset. |
| `POST /v2/interactive_publication/generate_meta` | Generate interactive publication metadata with usage-based pricing; requires a user auth token. |

## Authentication behavior

- Internal API key or internal auth token with no `external_user` payload uses the internal account and deducts internal generation credits.
- APP_KEY authentication uses `Authorization: AppKey <APP_KEY>` plus `x-app-secret: <APP_SECRET>`. It is a third internal-account auth method for `/v2` routes after the APP_KEY has been created with a normal API key or user auth token.
- Internal API key/auth token plus an `external_user` payload uses the external-user path and deducts that external user's credits.
- External-user auth tokens, internal API keys paired with an external-user API key, and customer sub-account API keys use the external-user path.
- Repeated video routes and status routes resolve `request_id` / `session_id` through external request records and `GlobalSession` records, so either returned `extreq_...` ids, normalized external ids, or internal video session ids can be used.
- `POST /v2/credits/grant` requires a signed-in administrator's user auth token. Customer or parent-account API keys, APP_KEY credentials, external-user auth tokens, and customer sub-account keys are not authorized.
- `POST /v2/interactive_publication/generate_meta` also has stricter credential rules: it accepts a user `auth_token`, not an API key or APP_KEY.

## External user registration

Use `POST /v2/user/create_external_user` to create or update an external user record under the authenticated internal Samsar user. Authenticate with an internal API key, internal user auth token, or APP_KEY. External-user auth tokens and customer sub-account auth cannot create new external users.

The route accepts a `unique_key` for the external user, such as a wallet address, email address, or your platform's user id. If `unique_key` is omitted, Samsar uses `external_user_id` as the `unique_key`. Future V2 calls can reference that external user with `unique_key`.

**Request**

```bash
curl -X POST "https://api.samsar.one/v2/user/create_external_user" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "unique_key": "wallet:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "email": "member@example.com",
    "display_name": "Member Name"
  }'
```

You can also send `provider`, `external_user_id`, `external_app_id`, `external_company_id`, `external_account_id`, `username`, `avatar_url`, `user_type`, and `metadata`. If `provider` is omitted, Samsar stores the record under the default V2 provider.

**Success response (201)**

```json
{
  "unique_key": "wallet:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "provider": "samsar_v2",
  "external_user_id": "wallet:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "external_app_id": null,
  "external_user": {
    "id": "65f...",
    "provider": "samsar_v2",
    "external_user_id": "wallet:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "unique_key": "wallet:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "email": "member@example.com",
    "display_name": "Member Name",
    "generation_credits": 0
  },
  "reference": {
    "provider": "samsar_v2",
    "unique_key": "wallet:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "external_user_id": "wallet:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "external_app_id": null
  }
}
```

If a matching `unique_key` or external identity already belongs to another internal user, the route returns `403`.

## User credits and tokens

### Manual credit grants

`POST /v2/credits/grant` manually mints credits for an external user and the owning platform account. Authenticate with `Authorization: Bearer <ADMIN_AUTH_TOKEN>` using a signed-in administrator's user auth token. Customer or parent-account API keys, APP_KEY credentials, external-user auth tokens, and customer sub-account keys are not authorized; authenticated callers without this administrator credential receive `403`.

The target external user must belong to the authenticated administrator's account; targets owned by another account return `403`. The credit amount must be a positive safe integer (at most `9007199254740991`).

Manual grants are administrative operations. For customer self-service purchases, use `POST /v2/credits/recharge` or the [external-user credit recharge flow](/external-users#post-external_userscreditsrecharge).

### Paid user recharge

Use `/v2/user/recharge_credits` when a client needs to create or top up a Samsar user account by email without first holding an API key. The route accepts `POST` or `GET`; `POST` is recommended.

**Request**

```bash
curl -X POST "https://api.samsar.one/v2/user/recharge_credits" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 25,
    "email": "customer@example.com",
    "redirect_url": "https://example.com/samsar/callback"
  }'
```

Fields:

- `amount` is a positive USD amount. Recharge credits use the deployment's configured credits-per-dollar rate, which defaults to **100 credits per USD**.
- `email` must be a valid email address.
- `redirect_url` must be HTTPS. The payment success webhook sends the token callback to this URL.

**Success response (200)**

```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "checkoutSessionId": "cs_test_...",
  "paymentStatusEndpoint": "/v2/user/payment_status",
  "amount": 25,
  "amountCents": 2500,
  "credits": 2500,
  "currency": "USD",
  "redirectUrl": "https://example.com/samsar/callback"
}
```

On Stripe payment success, Samsar:

- creates a user for `email` if one does not already exist,
- sends the new user a Samsar Studio email to confirm email and set a password,
- applies the purchased credits idempotently,
- mints a 10-day `authToken`,
- mints a rotating `refreshToken`,
- calls `redirect_url` with `authToken`, `refreshToken`, and `expiryDate` query parameters.

The webhook first attempts `GET <redirect_url>?authToken=...&refreshToken=...&expiryDate=...`. If that returns `404`, it retries `POST` to the same URL with the same query parameters and a JSON body containing the token and payment metadata.

Clients should store `authToken`, `refreshToken`, and `expiryDate`. Poll for a replacement token when the app opens within 3 days of `expiryDate`.

**Refresh token rotation**

```bash
curl -X POST "https://api.samsar.one/v2/user/refresh_token" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "srf_..."}'
```

**Success response (200)**

```json
{
  "tokenType": "Bearer",
  "authToken": "eyJ...",
  "refreshToken": "srf_new...",
  "expiryDate": "2026-05-08T12:00:00.000Z",
  "expiresInSeconds": 864000,
  "refreshTokenExpiresAt": "2026-07-27T12:00:00.000Z"
}
```

`/v2/user/refresh_token` consumes the old refresh token and returns both a new 10-day auth token and a new refresh token. Reusing the previous refresh token returns `401`.

Use the returned `authToken` as `Authorization: Bearer <authToken>` for `/v2/user/credits`, `/v2/user/usage/logs`, `/v2/user/payment_status`, and the rest of the internal `/v2` routes.

## App key credentials

Use `/v2/users/app_key` to mint one long-running APP_KEY for a user after the user is already authenticated with a Samsar API key or user auth token. `/v2/user/app_key` is accepted as an alias.

The client supplies a custom `secret`. Samsar returns the APP_KEY once, stores only an HMAC hash of the APP_KEY, and stores only a bcrypt hash of the secret. If an active APP_KEY already exists for the user, creation returns `409`.

**Create APP_KEY**

```bash
curl -X POST "https://api.samsar.one/v2/users/app_key" \
  -H "Authorization: Bearer $SAMSAR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "a-client-generated-secret-at-least-32-chars"
  }'
```

**Success response (201)**

```json
{
  "app_key": "sapp_...",
  "appKey": "sapp_...",
  "token_type": "AppKey",
  "expires_at": "2027-04-28T12:00:00.000Z",
  "app_key_record": {
    "id": "appkey_...",
    "appKeyPrefix": "sapp_abc12",
    "appKeyLast4": "9xyz",
    "status": "active",
    "expiresAt": "2027-04-28T12:00:00.000Z",
    "authScheme": "AppKey",
    "authHeader": "Authorization: AppKey <APP_KEY>",
    "secretHeader": "x-app-secret"
  }
}
```

Use the APP_KEY on authenticated `/v2` routes:

```bash
curl "https://api.samsar.one/v2/user/credits" \
  -H "Authorization: AppKey $SAMSAR_APP_KEY" \
  -H "x-app-secret: $SAMSAR_APP_SECRET"
```

If the APP_KEY expires, rotate it with the APP_KEY and APP_SECRET. The old APP_KEY is consumed and replaced; the APP_SECRET stays the same.

```bash
curl -X POST "https://api.samsar.one/v2/users/app_key/refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "app_key": "sapp_...",
    "secret": "a-client-generated-secret-at-least-32-chars"
  }'
```

`GET /v2/users/app_key` returns APP_KEY metadata for an authenticated user without returning the secret or full key. `DELETE /v2/users/app_key` revokes the active APP_KEY so the user can create a replacement.

## Media generation

`POST /v2/text_to_video` and `POST /v2/image_list_to_video` accept the corresponding [`/v1/video/*` request shapes](/video), either nested under `input` or sent as a flat JSON payload.

| Setting | Accepted values |
| --- | --- |
| `inference_model` / `inferenceModel` | `gpt-6-astra` (default), `gpt-6.1-sol`, `claude-opus-5.5`, `claude-fable-5.1`, `gemini-4-argon`, `QWEN3.8` (Qwen 3.8 Max for text and vision), `kimi-k3` |
| `backingtrack_model` / `music_provider` | `LYRIA3`, `ELEVENLABS_MUSIC` |
| `tts_model` / `tts_provider` | `ELEVENLABS`, `OPENAI`, `GOOGLE` |
| `speakerOptions` / `speaker_options` | Provider-specific speaker lists and Google speaker details |

`video_model_sub_type` is not part of the V2 request shape; put style direction in `prompt`. See [Models & pricing](/pricing) for current model keys, per-second rates, and runtime-availability guidance.

**Internal billing example**

```bash
curl -X POST "https://api.samsar.one/v2/image_list_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "image_urls": ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
      "video_model": "RUNWAYML",
      "express_cta_generation": true,
      "cta_url": "https://example.com/book",
      "limit_single_narrator": true
    }
  }'
```

**External-user billing example**

```bash
curl -X POST "https://api.samsar.one/v2/image_list_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "external_user": {
      "provider": "guidestination",
      "unique_key": "traveler_123",
      "external_user_id": "traveler_123"
    },
    "input": {
      "image_urls": ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
      "video_model": "KLINGIMGTOVID4",
      "add_narrator_avatar": true,
      "add_footer_animation": true,
      "footer_metadata": [
        { "url": "https://example.com/stop/1", "title": "Stop 1" },
        { "url": "https://example.com/stop/2", "title": "Stop 2" }
      ]
    }
  }'
```

For `/v2/image_list_to_video`, choose one outro mode and keep its fields together:

| Mode | Fields | Notes |
| --- | --- | --- |
| QR CTA outro | `cta_url` | Samsar generates the centered QR outro. |
| Center-image CTA | `outro_cta_image` | Use `{ "top_text", "middle_image", "bottom_text" }`. |
| Express CTA | `express_cta_generation: true`, one `cta_url` | Generates per-scene footer titles and outro text; adds 1 credit/sec. |

`add_outro_animation` defaults to `true`. `limit_single_narrator` keeps one narrator identity; `add_narrator_avatar` enables it automatically and adds **4 credits/sec**. The V2 route uses the same model defaults and rates as the V1 image-list route, summarized in the video model rate table.

### V2 image edit routes

The `/v2/image/enhance`, `/v2/image/remove_branding`, and `/v2/image/add_image_set` routes are thin aliases over the existing image API handlers and use the same image edit queue, validation, credit headers, and status polling behavior as `/v1/image/*`. Request bodies may be sent either directly or inside the standard V2 `{ "input": { ... } }` wrapper.

Image generation, enhancements, branding removal, and image sets use the [final image model prices](/pricing), charged on completion. Submission receipts show zero charged and pending billing; poll image status for final charges. Reuse the same `Idempotency-Key` when retrying a submission.

### Step-controlled video generation

Use the `/v2/video/step/*` routes when a client needs step-aware generation and detailed timeline preview data. Step requests use the same express video models and stage billing rules as `/v2/text_to_video` and `/v2/image_list_to_video`.

Step routes support two render modes:

- **1-step express render**: set `auto_render_full_video: true` and `manual_step_stages: []`. The request generates the full video without waiting for user approval before `ai_video_generation`.
- **2-step render**: set `auto_render_full_video: false` and `manual_step_stages: ["ai_video_generation"]`. The request pauses after image/audio assets are ready, then waits for `process_next` before the image-to-video stage.

When your request body uses the standard `{ "input": { ... } }` wrapper, include these fields inside `input`. Clients may also send the same fields at the top level for compatibility. Only call `process_next` when the status response says `waiting_for_process_next`, `requires_user_action`, or `can_process_next` is true.

Step-controlled routes are internal-account routes. Authenticate with a Samsar API key, user auth token, or APP_KEY.

**Create from text**

```bash
curl -X POST "https://api.samsar.one/v2/video/step/text_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auto_render_full_video": true,
    "manual_step_stages": [],
    "input": {
      "prompt": "A 20 second launch teaser for a new travel app",
      "image_model": "GPTIMAGE2.5",
      "video_model": "RUNWAYML",
      "duration": 20,
      "aspect_ratio": "16:9",
      "enable_subtitles": true,
      "auto_render_full_video": true,
      "manual_step_stages": []
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Create from an image**

```bash
curl -X POST "https://api.samsar.one/v2/video/step/image_to_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auto_render_full_video": false,
    "manual_step_stages": ["ai_video_generation"],
    "input": {
      "image_url": "https://cdn.example.com/product-frame.png",
      "prompt": "Turn this product frame into a cinematic ad",
      "video_model": "KLINGIMGTOVID4",
      "aspect_ratio": "16:9",
      "enable_subtitles": true,
      "auto_render_full_video": false,
      "manual_step_stages": ["ai_video_generation"]
    }
  }'
```

The response includes the normal `request_id` / `session_id` plus a `step` object. For 1-step requests, poll the detailed step status route until the final video is complete. For 2-step requests, poll until the response asks for user action, inspect `current_step_resources`, optionally edit resources through the relevant session/resource APIs, then call `process_next`.

```bash
curl "https://api.samsar.one/v2/video/step/65f1234567890abcdef12345/status" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

```json
{
  "request_id": "65f1234567890abcdef12345",
  "session_id": "65f1234567890abcdef12345",
  "status": "COMPLETED",
  "step_status": "COMPLETED",
  "current_step": "image_generation",
  "current_step_label": "Images",
  "next_step": "ai_video_generation",
  "waiting_for_process_next": true,
  "requires_user_action": true,
  "can_process_next": true,
  "manual_step_stages": ["ai_video_generation"],
  "process_next_url": "/v2/video/step/process_next",
  "current_step_resources": {
    "step": "image_generation",
    "label": "Images",
    "status": "COMPLETED",
    "completed_at": "2026-05-07T10:30:00.000Z",
    "resources": {
      "layers": [
        {
          "index": 0,
          "prompt": "Wide product shot with cinematic lighting",
          "selected_image_url": "https://cdn.samsar.one/generated/layer-0.png"
        }
      ]
    }
  },
  "completed_step_resources": {
    "prompt_generation": {
      "completed_at": "2026-05-07T10:27:00.000Z",
      "resources": {
        "input_prompt": "A 20 second launch teaser for a new travel app",
        "scenes": []
      }
    },
    "image_generation": {
      "completed_at": "2026-05-07T10:30:00.000Z",
      "resources": {
        "layers": []
      }
    }
  }
}
```

For preview playback before the final render, use `status_detailed`. It returns the same top-level status fields plus `status_detail_schema` and a normalized `session` object. The session payload includes only the data needed to reconstruct the current playable stage on the client: scene `layers`, `audioLayers`, `globalAudioLayers`, `globalVideos`, and final `result` metadata when available. Layer timing is normalized to `startTime` and `endTime`; the response does not expose internal fields such as `durationOffset`.

```bash
curl "https://api.samsar.one/v2/video/step/65f1234567890abcdef12345/status_detailed" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

Example response after `ai_video_generation` has completed, before lip sync, effects, or the final render:

```json
{
  "request_id": "65f1234567890abcdef12345",
  "session_id": "65f1234567890abcdef12345",
  "status": "COMPLETED",
  "type": "video",
  "provider": "RUNWAYML",
  "step_status": "COMPLETED",
  "current_step": "ai_video_generation",
  "current_step_label": "AI video",
  "next_step": "lip_sync_generation",
  "waiting_for_process_next": true,
  "process_next_url": "/v2/video/step/process_next",
  "status_detail_schema": "video_session_preview.v1",
  "session": {
    "id": "65f1234567890abcdef12345",
    "requestId": "65f1234567890abcdef12345",
    "type": "video",
    "routeType": "step",
    "aspectRatio": "16:9",
    "framesPerSecond": 30,
    "duration": 12,
    "language": "en",
    "hasSubtitles": true,
    "hasFooter": false,
    "inputPrompt": "A 12 second launch teaser for a new travel app",
    "generationType": "text_to_video",
    "provider": "RUNWAYML",
    "currentStage": "lip_sync_generation",
    "previewStage": "ai_video_generation",
    "completedStages": [
      "prompt_generation",
      "image_generation",
      "speech_generation",
      "music_generation",
      "audio_generation",
      "ai_video_generation"
    ],
    "stages": {
      "prompt_generation": "COMPLETED",
      "image_generation": "COMPLETED",
      "speech_generation": "COMPLETED",
      "music_generation": "COMPLETED",
      "audio_generation": "COMPLETED",
      "ai_video_generation": "COMPLETED",
      "lip_sync_generation": "INIT",
      "sound_effect_generation": "INIT",
      "video_generation": "INIT"
    },
    "layers": [
      {
        "index": 0,
        "id": "65f1234567890abcdef0001",
        "startTime": 0,
        "endTime": 6,
        "duration": 6,
        "prompt": "Wide product shot with cinematic lighting",
        "videoPrompt": "Slow push-in over the mobile booking screen",
        "image": {
          "status": "COMPLETED",
          "url": "https://cdn.samsar.one/generated/scene-0.png"
        },
        "aiVideo": {
          "status": "COMPLETED",
          "url": "https://cdn.samsar.one/generated/scene-0-ai.mp4"
        },
        "preview": {
          "stage": "ai_video_generation",
          "type": "video",
          "url": "https://cdn.samsar.one/generated/scene-0-ai.mp4"
        }
      },
      {
        "index": 1,
        "id": "65f1234567890abcdef0002",
        "startTime": 6,
        "endTime": 12,
        "duration": 6,
        "prompt": "Traveler checking into a hotel from the app",
        "videoPrompt": "Handheld travel lifestyle shot with warm daylight",
        "image": {
          "status": "COMPLETED",
          "url": "https://cdn.samsar.one/generated/scene-1.png"
        },
        "aiVideo": {
          "status": "COMPLETED",
          "url": "https://cdn.samsar.one/generated/scene-1-ai.mp4"
        },
        "preview": {
          "stage": "ai_video_generation",
          "type": "video",
          "url": "https://cdn.samsar.one/generated/scene-1-ai.mp4"
        }
      }
    ],
    "audioLayers": [
      {
        "index": 0,
        "type": "speech",
        "status": "COMPLETED",
        "startTime": 0,
        "endTime": 6,
        "duration": 6,
        "url": "https://cdn.samsar.one/generated/scene-0-speech.mp3",
        "speaker": "alloy",
        "connectedLayerIndex": 0
      },
      {
        "index": 1,
        "type": "speech",
        "status": "COMPLETED",
        "startTime": 6,
        "endTime": 12,
        "duration": 6,
        "url": "https://cdn.samsar.one/generated/scene-1-speech.mp3",
        "speaker": "alloy",
        "connectedLayerIndex": 1
      }
    ],
    "globalAudioLayers": [
      {
        "index": 0,
        "type": "music",
        "status": "COMPLETED",
        "startTime": 0,
        "endTime": 12,
        "duration": 12,
        "url": "https://cdn.samsar.one/generated/music-bed.mp3",
        "volume": 0.25
      }
    ],
    "result": {
      "hasSubtitles": true,
      "hasFooter": false,
      "language": "en"
    }
  }
}
```

Continue to the next stage:

```bash
curl -X POST "https://api.samsar.one/v2/video/step/65f1234567890abcdef12345/process_next" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

Step status values:

- `INIT`: the step request exists but has not started its first tracked stage.
- `PENDING`: the current stage is running.
- `COMPLETED`: the final video stage is complete, or a 2-step request is paused at a manual checkpoint and waiting for `process_next`.
- `FAILED`: the request failed.

The stage sequence is `prompt_generation`, `image_generation`, `speech_generation`, `music_generation`, `ai_video_generation`, `lip_sync_generation`, `sound_effect_generation`, `narrator_avatar_generation`, and `video_generation`.

**Translate example**

```bash
curl -X POST "https://api.samsar.one/v2/translate_video" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4",
      "language": "es",
      "enable_subtitles": false,
      "translate_outro": true,
      "translate_footer": true
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

`/v2/translate_video` and `/v2/retranslate_video` accept the same payload as `/v1/video/translate_video`. `enable_subtitles` defaults to `false`; when true, Samsar regenerates translated transcript/subtitle text. `translate_outro` and `translate_footer` default to `true` and localize stored generated-outro CTA text and footer CTA text when those metadata fields exist. The translate route no longer accepts `outro_image_url`; use `/v2/update_outro_image` for outro replacement.

**Footer update example**

```bash
curl -X POST "https://api.samsar.one/v2/update_footer_image" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4",
      "cta_text": "Scan to book",
      "cta_logo": "https://cdn.example.com/logo-white.png",
      "cta_url": "https://example.com/book"
    }
  }'
```

Set `remove_footer: true` in the `input` object to clone the session and remove all scene footers instead. Like `/v1/video/update_footer_image`, the V2 route queues only footer/frame/video work and charges 75 credits/request.

**Deep clone example**

```bash
curl -X POST "https://api.samsar.one/v2/video/clone" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4"
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

`/v2/video/clone` is free for an authenticated user who owns the source session. It copies the session data and local generated assets into a new session, marks all upstream generation stages complete, and queues only the final `video_generation` stage so the clone receives its own rendered video path and URL. Poll `/v2/status?request_id=<new_session_id>` until it returns the standard completed video payload with `result_url`, `has_subtitles`, and `result_language`.

**Reroll layers example**

```bash
curl -X POST "https://api.samsar.one/v2/reroll-layers" \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4",
      "layer_indexes": [3, 6, 11]
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

`/v2/reroll-layers` and `/v2/video/reroll-layers` clone the owned session for a reroll. The selected 1-based layers restart from image generation, then required AI-video and lip-sync/sound-effect work runs for those layers before frame/outro/final video generation reruns for the whole session. Image, AI-video, lip-sync and sound-effect model calls are charged on completion. Send `quote_only: true` to review the selected scenes; submission charges are zero while final usage is pending. See [final model-call prices](/pricing#video-model-calls).

### External video provider routes

Use `/v2/external/video/*` when a remote deployment needs hosted Samsar generation through a Samsar API key. These are standalone provider-style endpoints, separate from `/v2/video/step/*`.

Supported routes:

- `POST /v2/external/video/text_to_video`
- `POST /v2/external/video/image_to_video`
- `POST /v2/external/video/direct_image_to_video`
- `POST /v2/external/video/direct_text_to_video`
- `POST /v2/external/video/narrative_to_video`
- `POST /v2/external/video/text_to_interactive_video`
- `POST /v2/external/video/lip_sync`
- `POST /v2/external/video/sound_effect`
- `GET` or `POST /v2/external/video/status`
- `GET` or `POST /v2/external/video/{request_id}/status`
- `GET` or `POST /v2/external/video/status_detailed`
- `GET` or `POST /v2/external/video/{request_id}/status_detailed`

`text_to_video` accepts the same express text input shape as `/v2/text_to_video`. `image_to_video` requires exactly one public `image_url` (or a one-item `image_urls` array) plus `video_model`. `narrative_to_video` accepts a completed singular or branched `narrative_request_id`, inherits its prompt and duration, and skips prompt generation; see [Render a narrative as video](/narrative/render-video). `lip_sync` requires public `video_url` and `audio_url` values. `sound_effect` requires a public `video_url` and prompt. Raw media bytes, data URLs, local filesystem paths, localhost URLs, and private network URLs are not accepted for hosted external video-to-video routes.

For a branched narrative-to-video request, both status routes return a normalized `branching` manifest. The normal status response is compact and contains tree choices, aggregate path progress, per-path frame/video status, and any completed path result. Detailed status adds path timelines that reference the shared `session.layers` and `session.audioLayers` catalogs by ID; it does not return internal frame lists. A top-level `COMPLETED` result is published only after every required leaf video is ready.

## Assistant and utilities

Assistant and utility routes use the same actor resolution behavior as the rest of `/v2`. Use them when a mixed internal/external-user client needs assistant completions, assistant sessions, usage charges, or cleaned-text embeddings through one API prefix.

Supported assistant and utility routes:

- `POST /v2/assistant/set_system_prompt`
- `POST /v2/assistant/completion`
- `POST /v2/external/chat`
- `POST /v2/external/chat/completions`
- `POST /v2/external/assistant`
- `POST /v2/external/assistant/completions`
- `GET /v2/external/chat/status`
- `GET /v2/external/chat/completions/status`
- `GET /v2/external/assistant/status`
- `POST /v2/external/moderation`
- `POST /v2/external/moderations`
- `POST /v2/external/audio/text_to_speech`
- `POST /v2/external/audio/text_to_music`
- `POST /v2/external/audio/text_to_sound_effect`
- `POST /v2/external/audio/transcript_align`
- `GET` or `POST /v2/external/audio/status`
- `POST /v2/external/embeddings`
- `POST /v2/utils/assistant_session`
- `POST /v2/utils/usage_charge`
- `POST /v2/generate_embeddings_from_plain_text`

Session assistant completions and external chat/assistant aliases share the final input, output, and cached-input token prices on the listed model and adapter routes. Production agent pipeline inference keeps its flat stage pricing, and other utilities retain their own endpoint rates.

External chat/assistant completions return JSON by default, support [named SSE events](/external-requests#streaming-completion) with `stream: true`, or offer [queued polling](/external-requests#queued-completion-with-polling). Streaming and polling cannot be combined. Session-bound `/v2/assistant/completion` remains a JSON endpoint.

External aliases accept OpenAI-compatible text and vision messages and execute synchronously by default. Set `response_mode: "polling"` for an HTTP `202` queued response, persist `request_id`, and poll a status route until `COMPLETED` or `FAILED`. Reuse `Idempotency-Key` or `client_request_id` after a network reset; the SDK option is `{ idempotencyKey: 'stable-request-id' }`. Client request IDs take precedence when both are supplied and also support status lookup. Completed replays reuse the original response and debit; a changed payload under the same key returns `409`. Polling adds no inference charge.

The default execution timeout is 10 minutes and default polling-record retention is 24 hours. Requests awaiting billing confirmation or completion after a timeout can remain pending beyond that period. Paid tools may incur separate charges. See [Assistant billing and retries](/assistant-api#billing-and-retries) and [External assistant and chat completions](/external-requests#external-assistant-and-chat-completions) for request keys, polling, and credit receipts.

External moderation routes accept OpenAI-compatible moderation input and do not charge credits. Hosted audio charges **1 credit/request** for text to speech or sound effects and **2 credits/request** for text to music; music accepts `ELEVENLABS_MUSIC` and `LYRIA3`. Transcript alignment is usage based, and external embeddings cost **100 credits per 1M tokens**.

## Request status and publishing

Use `GET /v2/status` with any `request_id` returned by a V2 generation route. Status resolution accepts external request ids, normalized external ids, and internal video session ids where available.

Use `GET /v2/status_detailed` or `POST /v2/status_detailed` when a video client needs preview assets before the final render finishes. Detailed status is additive: every existing `/v2/status` field remains unchanged, and video requests also include `status_detail_schema: "video_session_preview.v1"` with a normalized `session` preview payload. Use `session.previewStage` to choose the furthest playable stage, then render scene clips from `session.layers[].preview`, speech from `session.audioLayers`, background audio from `session.globalAudioLayers`, and final output metadata from `session.result` once available.

When image, AI-video, lip-sync, sound-effect, or final video generation reaches a terminal failure, `/v2/status` and `/v2/status_detailed` promote the exact stored provider/model message to `generationError`, `expressGenerationError`, `error`, and `message`. Detailed status also keeps the error on the failed layer asset (`session.layers[].imageSession.generationError`, `aiVideoGenerationError`, `lipSyncVideoGenerationError`, or `soundEffectVideoGenerationError`). Clients should display this message as-is for the terminal failure. Stale errors from a layer that is actively retrying or has since completed are not treated as terminal.

Branched video sessions additionally include `branching.schema: "branched_video_status.v1"` on both status responses. Use `branching.summary` for aggregate leaf-render progress, `branching.tree.choice_points` for interactive choices, and `branching.paths` for path-specific frame/video state. On detailed status, each path also includes a normalized `timeline` and `audio_timeline`; resolve their `layer_id` and `audio_layer_id` references against the shared assets in `session.layers` and `session.audioLayers`. This keeps preview responses normalized even when several paths share the same parent scenes.

When all leaf renders complete, `branching.outputs.ready` becomes `true`, `branching.outputs.paths` maps each leaf `path_id` to its final URL, top-level `result_url` identifies the default path, and ordered `result_urls` contains all leaf videos. The older `branch_results` mapping remains available for compatibility. See [Render a narrative as video](/narrative/render-video#branch-rendering) for the complete response and client-switching flow.

Publishing and archive routes operate on the resolved actor's accessible assets:

- `POST /v2/archive`
- `POST /v2/publish`

### Direct video model billing

Studio calls, rerolled scenes, `image_to_video`, `direct_image_to_video`, `direct_text_to_video`, `lip_sync` and `sound_effect` settle each completed model call individually. See the [final media prices and billing units](/pricing#video-model-calls) and [image prices](/pricing#image-models). Submission has no prepaid model charge; poll status for `creditsCharged`, `remainingCredits` and `billingStatus`. Keep the original request key while billing is pending.

Kling 4 (`KLINGIMGTOVID4` and `KLINGTXTTOVID4`) generates 720p clips of **5, 10, 15, 20, 25, or 30 seconds**, without native audio. Studio and direct model calls cost **18.84 credits per second** ($0.1884/sec). The production agent workflow remains **36 credits per second**. Older Kling 3 Pro and Turbo request keys are accepted as aliases for new Kling 4 requests.

`direct_text_to_video` accepts a prompt, `video_model` (`VEO3.1`, `VEO3.1FAST`, `HAILUOPRO` or `KLINGTXTTOVID4`), duration and aspect ratio. Supply `Idempotency-Key` or `client_request_id`. The full `text_to_video` agent workflow retains its fixed production pricing. Standalone model adapters call the direct routes and waive local credit debits.

### GPT and Claude effort

For GPT 6 Astra, GPT 6.1 Sol, Claude Opus 5.5, and Claude Fable 5.1, pass `effort: "high"` or `effort: "xhigh"` alongside `inference_model`. Both text inference and vision use the selected model and effort. Existing account defaults remain unchanged; the default is GPT 6 Astra at `high`.


<a id="document-cf49cb6fa9921dff55bfda3add77d8d0"></a>
## Video API

Source class: docs; audience: public; freshness: current.

Sources: https://docs.samsar.one/video

# Video API

Choose scene models in the [video matrix](/models?modality=video), then check this deployment’s Express allowlist below. Start with hosted **samsar-js**; the [adapter guide](/adapters) explains native and standalone choices.

Queue a sample video request with your API key and watch status updates without leaving the docs.

**Quick facts**

- Base URL: `https://api.samsar.one/v1`
- Authentication: `Bearer API key`
- Execution: `Asynchronous · webhook or status polling`
- Billing: `Workflow stages, fixed operation fees, or completion billing by route`
- Content type: `application/json`

## Pricing

Video generation is duration-based; editing and control routes use simpler flat or no-charge rules.

| Operation | Billing rule |
| --- | --- |
| Text-to-video | `duration_seconds × model_rate` (**20–60 credits/sec**) |
| Image-list-to-video | Same formula; narrator avatar adds **4 credits/sec** and express CTA adds **1 credit/sec** |
| Translate or join | **3 credits/sec** |
| Add or update outro/footer image | **75 credits/request** |
| Reroll selected layers | Completed image, video, lip-sync, and sound-effect model calls |
| Clone, subtitles, or cancel | No additional charge |

The video model comparison has the current model keys, supported duration units, exact per-second rates, and endpoint rate card. For asynchronous model calls, use the completed status receipt; submission headers are not the final charge.

## GET /video/supported_models

Fetch the currently supported `image_model` and `video_model` keys for `POST /video/text_to_video`.

**Request**

```bash
curl "https://api.samsar.one/v1/video/supported_models"
```

**Selected response fields (200)**

```json
{
  "IMAGE_MODELS": [
    {
      "label": "GPTImage 2.6",
      "value": "GPTIMAGE2.5",
      "basePrice": 46
    }
  ],
  "VIDEO_MODELS": [
    {
      "label": "Kling 4 Img2Vid",
      "value": "KLINGIMGTOVID4",
      "basePrice": 36,
      "pricingDistribution": {
        "pipeline": 4,
        "inference": 4,
        "image_gen_edit": 2,
        "speech": 2,
        "music": 2,
        "effects_and_lipsync": 2,
        "video": 20,
        "total": 36,
        "optionalAddons": {
          "express_cta_generation": 1
        }
      }
    }
  ]
}
```

- `IMAGE_MODELS` and `VIDEO_MODELS` are generated from the server-side text-to-video allowlist. The arrays shown above are representative and can be filtered by runtime deployment availability.
- The full response also includes `IMAGE_EDIT_MODELS`, route-specific `text_to_video` and `image_list_to_video` catalogs, `image_edit_models`, deployment capability data under `deployment` and `available`, `available_providers`, and audio availability.
- Each standard priced item includes `label` (display text), `value` (request key), `basePrice` (lowest configured per-unit price for that model), and `pricingDistribution` in credits/sec. `pricingDistribution.optionalAddons.express_cta_generation` is the image-list express CTA surcharge in credits/sec. Custom image-to-video adapters are configured through the top-level custom model configuration, not as a standard `VIDEO_MODELS` item.
- Use each item’s `value` directly as `image_model` and `video_model` in `POST /video/text_to_video`.
- This endpoint does not require authentication.

## POST /video/text_to_video

Submit a prompt-only request to start video generation. Webhooks are optional.

**Request body**

```json
{
  "input": {
    "prompt": "Required text, max 4000 chars",
    "image_model": "GPTIMAGE2.5 | NANOBANANAPRO | SEEDREAM | WAN2.7PRO",
    "video_model": "VEO3.1I2V | VEO3.1I2VFAST | COSMOS3SUPERI2V | SEEDANCEI2V | SEEDANCE2.5I2V | KLINGIMGTOVID4 | HAPPYHORSEI2V | RUNWAYML",
    "duration": 30,
    "tone": "grounded | cinematic",
    "aspect_ratio": "16:9 | 9:16",
    "language": "auto | en | es | fr | ja | th | zh | bn | hi | sa | la",
    "backingtrack_model": "LYRIA3 | ELEVENLABS_MUSIC",
    "tts_model": "ELEVENLABS | OPENAI | GOOGLE",
    "speakerOptions": { "openAISpeakers": ["nova"] },
    "inference_model": "gpt-6-astra | gpt-6.1-sol | claude-opus-5.5 | claude-fable-5.1 | gemini-4-argon | QWEN3.8 | kimi-k3",
    "enable_subtitles": true,
    "font_key": "Poppins",
    "outro_image_url": "https://cdn.example.com/outro.png",
    "generate_outro_image": false,
    "cta_url": "https://example.com/book",
    "cta_text_top": "Scan to book",
    "cta_text_bottom": "Limited availability",
    "cta_logo": "https://cdn.example.com/logo-white.png",
    "outro_cta_image": {
      "top_text": "Shop the drop",
      "middle_image": { "url": "https://cdn.example.com/drop-logo.png" },
      "bottom_text": "Limited availability"
    },
    "add_footer_animation": true,
    "footer_metadata": [
      { "url": "https://example.com/book", "title": "Book now" }
    ]
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `prompt`, `image_model`, `video_model`, `duration` are required; `duration` ≤ 240 seconds.
- `language` is optional; pass `auto` (default) or one of the listed language codes.
- `backingtrack_model` optional; selects the express backing track generator. Use `LYRIA3` for Google Lyria 3 Pro native music generation or `ELEVENLABS_MUSIC` for ElevenLabs Music. Compatibility aliases include `backing_track_model`, `backingTrackModel`, `music_provider`, and `musicProvider`; legacy `LYRIA2` requests are treated as `LYRIA3`.
- `tts_model` optional; selects the speaker library used for text-to-speech assignment. Use `ELEVENLABS`, `OPENAI`, or `GOOGLE`. Compatibility aliases include `ttsModel`, `tts_provider`, and `ttsProvider`. When omitted, Samsar uses the default speaker assignment behavior.
- `speakerOptions` optional; compatibility alias: `speaker_options`. Use it with `tts_model` to constrain assignment to `openAISpeakers`, `elevenLabsSpeakers`, or `googleSpeakers`. When provided, request speaker options override account speaker settings for that request. Google TTS requests should include `googleSpeakerDetails` entries with `value` or `voiceId`, `languageCode` or `languageCodes`, and gender metadata such as `Gender` or `ssmlGender`.
- `inference_model` optional; selects the render-planning model. Supported values are `gpt-6-astra`, `gpt-6.1-sol`, `claude-opus-5.5`, `claude-fable-5.1`, `gemini-4-argon`, `QWEN3.8`, and `kimi-k3`. `QWEN3.8` uses Qwen 3.8 Max for text and vision. Compatibility alias: `inferenceModel`. When omitted, Samsar uses the account default (`gpt-6-astra`).
- `enable_subtitles` optional; defaults to `true`. Set to `false` to skip subtitle generation entirely.
- `font_key` optional; must be supported for the chosen `language`. It sets both subtitle and speaker fonts. Use `GET /supported_fonts` or [/fonts](/fonts) to preview choices.
- Provided outro image mode: set `outro_image_url` to append a custom outro frame. `add_outro_animation` is optional; when true, it applies a fade overlay during the outro. `add_outro_focus_area` requires `add_outro_animation: true` and a valid `outro_focust_area`.
- Generated outro image mode: set `generate_outro_image: true` and provide either `cta_url` for a QR center image or `outro_cta_image` for a supplied center logo/CTA image. `outro_cta_image` uses `{ "top_text", "middle_image", "bottom_text" }`; `middle_image` accepts a public URL (`{ "url" }`, `{ "image_url" }`) or image data (`{ "data_url" }`, `{ "image_data", "mime_type" }`). Top-level `cta_text_top` and `cta_text_bottom` remain supported for generated outros. This mode automatically enables `add_outro_animation`, `add_outro_focus_area`, and computes `outro_focust_area`.
- Footer QR mode: set `add_footer_animation: true` and provide `footer_metadata` with `{ "url", "title" }` items. A single item is applied to every generated scene; multiple items map by generated scene index. The frame processor renders the bottom CTA section only on layers where this option is enabled.
- Use only one outro mode in a request. If `generate_outro_image` is true, omit `outro_image_url`, `add_outro_animation`, `add_outro_focus_area`, and `outro_focust_area` because Samsar derives those values.
- `outro_focust_area` / `outro_focus_area` values are `{ x, y, width, height }` within the output canvas (`16:9` is `1792x1024`, `9:16` is `1024x1792`).
- `video_model_sub_type` is not part of the request shape; describe style direction in `prompt` and `tone`.
- Request bodies can be nested under `input` (recommended) or sent as a flat JSON payload.

### Scene duration and workflow pricing

`SEEDANCE2.5I2V` is a frame-to-video model used for the scene animation stage of both text-to-video and image-list-to-video. Samsar first applies its normal narrative, scene, and connected-audio timing. Each scene is then assigned the smallest supported Seedance 2.5 duration that can contain that timing: `5`, `10`, or `15` seconds. For example, connected audio durations of 4, 8, and 14 seconds produce 5-, 10-, and 15-second scene renders.

Seedance 2.5 requests render at `720p`. Fal receives the selected `aspect_ratio`; GMICloud through GenBlaze sends `ratio: "adaptive"` for framed generation so the already-sized first frame determines the output shape. `generate_audio` is enabled only when the AI-video layer type is `sound_effect`; narration, music, and ordinary scene audio continue through Samsar's separate audio stages.

Standalone Docker can expose GMICloud, Fal, and Samsar-js adapters for this model. One adapter is selected per request from the enabled order saved in **Settings → Model Adapters**; the same layer request is never submitted to multiple adapters. Hosted production and hosted external Seedance 2.5 requests are pinned to the validated GMICloud route `seedance-2-5-260628` without a Fal fallback.

Kling 4 (`KLINGIMGTOVID4`) uses 720p clips of 5, 10, 15, 20, 25, or 30 seconds without native audio. Happy Horse 1.1 (`HAPPYHORSEI2V`) uses 5-, 10-, or 15-second scene clips. These are per-scene generation units, not the total requested video length.

The standard Express rate class charges Seedance 2.5 at 50 credits/sec; Agent/Vidgenie and step-controlled generation use 60 credits/sec. Kling 4 remains 36 credits/sec for the full workflow. Direct model-call prices are separate; see [workflow and clip pricing](/pricing#video-models).

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/text_to_video \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "A timelapse of clouds over a futuristic city at sunrise",
      "duration": 30,
      "image_model": "GPTIMAGE2.5",
      "video_model": "RUNWAYML",
      "tone": "grounded",
      "aspect_ratio": "16:9",
      "language": "en",
      "enable_subtitles": true,
      "font_key": "Poppins",
      "generate_outro_image": true,
      "cta_url": "https://example.com/tour",
      "cta_text_top": "Scan for the tour",
      "cta_text_bottom": "Book a demo",
      "add_footer_animation": true,
      "footer_metadata": [
        { "url": "https://example.com/tour", "title": "Book a demo" }
      ]
    }
  }'
```

**Sample request: generate CTA image outro with a center logo**

```bash
curl -X POST https://api.samsar.one/v1/video/text_to_video \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "A cinematic launch teaser for a new product line",
      "duration": 20,
      "image_model": "GPTIMAGE2.5",
      "video_model": "RUNWAYML",
      "aspect_ratio": "9:16",
      "generate_outro_image": true,
      "outro_cta_image": {
        "top_text": "Shop the drop",
        "middle_image": { "url": "https://cdn.example.com/drop-logo.png" },
        "bottom_text": "Limited availability"
      }
    }
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_a1b2c3d4",
  "session_id": "vid_a1b2c3d4"
}
```

**Error responses**

- `400` invalid or missing fields (empty prompt, unsupported models, duration > 240, etc.)
- `401` invalid API key

## POST /video/image_list_to_video

Create a video from an ordered list of images. Samsar builds a narrative from the images and optional metadata, then renders the video using `VEO3.1I2V`, `VEO3.1I2VFAST`, `COSMOS3SUPERI2V`, `SEEDANCEI2V`, `SEEDANCE2.5I2V`, `KLINGIMGTOVID4`, `HAPPYHORSEI2V`, or `RUNWAYML`. If `video_model` is omitted, it defaults to `RUNWAYML`.

**Request body**

```json
{
  "input": {
    "image_urls": [
      "https://cdn.example.com/frame1.png",
      "https://cdn.example.com/frame2.png"
    ],
    "prompt": "Optional high-level direction",
    "metadata": { "project": "launch_trailer" },
    "video_model": "VEO3.1I2V | VEO3.1I2VFAST | COSMOS3SUPERI2V | SEEDANCEI2V | SEEDANCE2.5I2V | KLINGIMGTOVID4 | HAPPYHORSEI2V | RUNWAYML",
    "image_model": "GPTIMAGE2.5 | NANOBANANAPRO | SEEDREAM | WAN2.7PRO",
    "aspect_ratio": "16:9 | 9:16",
    "language": "auto | en | es | fr | ja | th | zh | bn | hi | sa | la",
    "backingtrack_model": "LYRIA3 | ELEVENLABS_MUSIC",
    "tts_model": "ELEVENLABS | OPENAI | GOOGLE",
    "speakerOptions": { "openAISpeakers": ["nova"] },
    "inference_model": "gpt-6-astra | gpt-6.1-sol | claude-opus-5.5 | claude-fable-5.1 | gemini-4-argon | QWEN3.8 | kimi-k3",
    "enable_subtitles": true,
    "font_key": "Poppins",
    "limit_single_narrator": false,
    "add_narrator_avatar": false,
    "generate_outro_image": false,
    "express_cta_generation": false,
    "cta_url": "https://example.com/book",
    "cta_text_top": "Scan to book",
    "cta_text_bottom": "Limited availability",
    "cta_logo": "https://cdn.example.com/logo-white.png",
    "outro_cta_image": {
      "top_text": "Shop the drop",
      "middle_image": { "url": "https://cdn.example.com/drop-logo.png" },
      "bottom_text": "Limited availability"
    },
    "add_footer_animation": false,
    "footer_metadata": [
      { "url": "https://example.com/blue-lagoon", "title": "Blue Lagoon Tour" }
    ]
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `image_urls` required; non-empty array of URL strings or objects containing `image_url`, `imageUrl`, `url`, `src`, `enhanced_url`, or `enhancedUrl`. Object entries may also include `title`, `image_text`, `activity_title`, `name`, or `label` for narration context.
- `metadata` optional plain object forwarded into the narrative builder.
- `prompt` optional text used to guide pacing/tone.
- `video_model` optional; supported values are `VEO3.1I2V`, `VEO3.1I2VFAST`, `COSMOS3SUPERI2V`, `SEEDANCEI2V`, `SEEDANCE2.5I2V`, `KLINGIMGTOVID4`, `HAPPYHORSEI2V`, and `RUNWAYML`. Defaults to `RUNWAYML`.
- `aspect_ratio` optional; supports `16:9` and `9:16`. Omitted or unsupported values fall back to `16:9`.
- `language` optional; defaults to `auto` for detection.
- `backingtrack_model` optional; selects the express backing track generator. Use `LYRIA3` for Google Lyria 3 Pro native music generation or `ELEVENLABS_MUSIC` for ElevenLabs Music. Compatibility aliases include `backing_track_model`, `backingTrackModel`, `music_provider`, and `musicProvider`; legacy `LYRIA2` requests are treated as `LYRIA3`.
- `tts_model` optional; selects the speaker library used for text-to-speech assignment. Use `ELEVENLABS`, `OPENAI`, or `GOOGLE`. Compatibility aliases include `ttsModel`, `tts_provider`, and `ttsProvider`. When omitted, Samsar uses the default speaker assignment behavior.
- `speakerOptions` optional; compatibility alias: `speaker_options`. Use it with `tts_model` to constrain assignment to `openAISpeakers`, `elevenLabsSpeakers`, or `googleSpeakers`. When provided, request speaker options override account speaker settings for that request. Google TTS requests should include `googleSpeakerDetails` entries with `value` or `voiceId`, `languageCode` or `languageCodes`, and gender metadata such as `Gender` or `ssmlGender`.
- `inference_model` optional; selects the render-planning model. Supported values are `gpt-6-astra`, `gpt-6.1-sol`, `claude-opus-5.5`, `claude-fable-5.1`, `gemini-4-argon`, `QWEN3.8`, and `kimi-k3`. `QWEN3.8` uses Qwen 3.8 Max for text and vision. Compatibility alias: `inferenceModel`. When omitted, Samsar uses the account default (`gpt-6-astra`).
- `enable_subtitles` optional; defaults to `true`. Set to `false` to skip subtitle generation entirely.
- `font_key` optional; must be supported for the chosen `language`. It sets both subtitle and speaker fonts.
- `limit_single_narrator` optional boolean; defaults to `false`. When true, Samsar keeps all narration under one narrator identity.
- `add_narrator_avatar` optional boolean; defaults to `false`. When true, Samsar automatically enables `limit_single_narrator`, generates an influencer-style human narrator avatar suitable for the image-list narrative, and overlays the avatar video bottom-center or centered in the footer row when footer metadata is present.
- Provided outro image mode: set `outro_image_url` to append a custom outro frame. `add_outro_animation` is optional; when true, it applies a fade-to-black overlay during the outro. `add_outro_focus_area` requires `add_outro_animation: true` and a valid `outro_focust_area`.
- Generated outro image mode: set `generate_outro_image: true` and provide either `cta_url` for a QR center image or `outro_cta_image` for a supplied center logo/CTA image. `outro_cta_image` uses `{ "top_text", "middle_image", "bottom_text" }`; `middle_image` accepts a public URL (`{ "url" }`, `{ "image_url" }`) or image data (`{ "data_url" }`, `{ "image_data", "mime_type" }`). Top-level `cta_text_top` and `cta_text_bottom` remain supported for generated outros. This mode automatically enables `add_outro_animation`, `add_outro_focus_area`, and computes `outro_focust_area`.
- Footer QR mode: set `add_footer_animation: true` and provide `footer_metadata` with one `{ "url", "title" }` item per image scene. Samsar generates one QR image per scene in the frame processor and renders a footer section on every frame with the title on the left and QR code on the right.
- Express CTA generation mode: set `express_cta_generation: true` with one `cta_url` and omit `cta_text_top`, `cta_text_bottom`, and `footer_metadata`. Samsar generates concise per-scene footer CTA titles from the image scene payload and clean outro CTA text from the session context, then normalizes the request into the same generated-outro and footer payload shape before rendering. Compatibility aliases include `expressCtaGeneration`, `auto_generate_cta_text`, `autoGenerateCtaText`, `generate_cta_texts`, and `generateCtaTexts`.
- Use only one outro mode in a request. If `generate_outro_image` or `express_cta_generation` is true, omit `outro_image_url`, `add_outro_animation`, `add_outro_focus_area`, and `outro_focust_area` because Samsar derives those values.
- `outro_focust_area` / `outro_focus_area` values are `{ x, y, width, height }` within the output canvas (`16:9` is `1792x1024`, `9:16` is `1024x1792`).
- `video_model_sub_type` is not part of the request shape; describe style direction in `prompt`.
- Billing uses the selected model rate × final duration. Narrator avatar generation adds **4 credits/sec** and express CTA generation adds **1 credit/sec**; see the central video rate table for exact model prices.

**Sample request: provided outro image**

```bash
curl -X POST https://api.samsar.one/v1/video/image_list_to_video \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "image_urls": [
        "https://cdn.example.com/frame1.png",
        "https://cdn.example.com/frame2.png"
      ],
      "prompt": "Make this feel like a fast-paced teaser",
      "metadata": { "project": "launch_trailer" },
      "video_model": "KLINGIMGTOVID4",
      "aspect_ratio": "16:9",
      "language": "en",
      "enable_subtitles": true,
      "font_key": "Poppins",
      "limit_single_narrator": true,
      "outro_image_url": "https://cdn.example.com/outro.png",
      "add_outro_animation": true,
      "add_outro_focus_area": true,
      "outro_focust_area": { "x": 240, "y": 140, "width": 720, "height": 420 }
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Sample request: generate QR outro image server-side**

```bash
curl -X POST https://api.samsar.one/v1/video/image_list_to_video \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "image_urls": [
        { "image_url": "https://cdn.example.com/frame1.png", "title": "Blue Lagoon Tour" },
        { "image_url": "https://cdn.example.com/frame2.png", "title": "Sunset Dinner" }
      ],
      "prompt": "Travel offer reel with a scannable booking outro",
      "metadata": { "project": "destination_campaign" },
      "video_model": "RUNWAYML",
      "aspect_ratio": "9:16",
      "language": "en",
      "enable_subtitles": true,
      "font_key": "Poppins",
      "add_narrator_avatar": true,
      "generate_outro_image": true,
      "cta_url": "https://example.com/book",
      "cta_text_top": "Scan to book",
      "cta_text_bottom": "Limited availability",
      "cta_logo": "https://cdn.example.com/logo-white.png",
      "add_footer_animation": true,
      "footer_metadata": [
        { "url": "https://example.com/blue-lagoon", "title": "Blue Lagoon Tour" },
        { "url": "https://example.com/sunset-dinner", "title": "Sunset Dinner" }
      ]
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Sample request: generate CTA image outro with a center logo**

```bash
curl -X POST https://api.samsar.one/v1/video/image_list_to_video \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "image_urls": [
        "https://cdn.example.com/frame1.png",
        "https://cdn.example.com/frame2.png"
      ],
      "prompt": "Product launch teaser with a branded CTA outro",
      "video_model": "RUNWAYML",
      "aspect_ratio": "9:16",
      "generate_outro_image": true,
      "outro_cta_image": {
        "top_text": "Shop the drop",
        "middle_image": { "url": "https://cdn.example.com/drop-logo.png" },
        "bottom_text": "Limited availability"
      }
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Sample request: express CTA generation from one link**

```bash
curl -X POST https://api.samsar.one/v1/video/image_list_to_video \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "image_urls": [
        { "image_url": "https://cdn.example.com/frame1.png", "title": "Blue Lagoon Tour" },
        { "image_url": "https://cdn.example.com/frame2.png", "title": "Sunset Dinner" }
      ],
      "prompt": "Travel offer reel with concise scene CTAs",
      "metadata": { "brand": "Guidestination", "offer": "Bookable Bangkok experiences" },
      "video_model": "RUNWAYML",
      "aspect_ratio": "9:16",
      "language": "en",
      "enable_subtitles": true,
      "font_key": "Poppins",
      "express_cta_generation": true,
      "cta_url": "https://example.com/book"
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_img_a1b2c3",
  "session_id": "vid_img_a1b2c3"
}
```

**Error responses**

- `400` invalid or missing `image_urls`.
- `401` invalid API key.

## POST /external_users/text_to_video and /external_users/image_list_to_video

External-user video creation routes accept the same `input` parameters as `/video/text_to_video` and `/video/image_list_to_video`, including generated CTA outros (`generate_outro_image` with `cta_url` for a QR center image or `outro_cta_image` for a supplied center logo/CTA image), image-list express CTA generation (`express_cta_generation` with `cta_url`), provided outro images, footer QR sections (`add_footer_animation`, `footer_metadata`), subtitle/font options, optional `speakerOptions`, optional `inference_model`, and image-list `video_model` / `aspect_ratio`, `limit_single_narrator`, and `add_narrator_avatar`.

Wrap the request with an `external_user` object. Responses return an external request/session id; either the returned `extreq_...` id or the normalized external id can be used with `/external_users/status`, `/external_users/add_outro_image`, `/external_users/update_outro_image`, `/external_users/update_footer_image`, `/external_users/translate_video`, and `/external_users/join_videos`.

External user records store a stable `unique_key`. If `unique_key` is not provided, Samsar uses `external_user_id` as the key. V2 clients can create and later reference an external user through `POST /v2/user/create_external_user`.

Repeated video routes also perform server-side compatibility routing. If a main `/video/*` route receives an external request id, normalized external id, or external-owned upstream session id, it is processed through the external-user billing path. If an `/external_users/*` route receives a normal internal `GlobalSession`/video session id owned by the authenticated account and no external user context is supplied, it is processed through the internal billing path.

```json
{
  "external_user": {
    "provider": "guidestination",
    "unique_key": "traveler_123",
    "external_user_id": "traveler_123"
  },
  "input": {
    "image_urls": [
      { "image_url": "https://cdn.example.com/frame1.png", "title": "Blue Lagoon Tour" }
    ],
    "video_model": "RUNWAYML",
    "generate_outro_image": true,
    "cta_url": "https://example.com/book",
    "add_footer_animation": true,
    "footer_metadata": [
      { "url": "https://example.com/book", "title": "Book now" }
    ]
  },
  "webhookUrl": "https://example.com/webhook"
}
```

## POST /video/add_outro_image

Clone an existing session, then add or replace the outro image in the cloned session and queue frame/video generation. Use a provided full outro image, or ask Samsar to generate the outro from existing session image layers with either a QR center image or supplied center logo/CTA image.

**Request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "outro_image_url": "https://cdn.example.com/outro.png",
    "add_outro_animation": true,
    "add_outro_focus_area": true,
    "outro_focust_area": { "x": 240, "y": 140, "width": 720, "height": 420 }
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `videoSessionId` required; must belong to the API key.
- `outro_image_url` required unless `generate_outro_image` is true; URL (or data URL) for a full outro image.
- `generate_outro_image` optional boolean; when true, provide either `cta_url` or `outro_cta_image` and omit `outro_image_url`.
- `cta_url` optional for generated outro mode; when provided, it is converted into a scannable QR code in the center image area.
- `outro_cta_image` optional for generated outro mode; uses `{ "top_text", "middle_image", "bottom_text" }` and places `middle_image` directly in the same center area used by QR outros, resized without changing aspect ratio.
- `add_outro_animation` optional boolean; when true, adds a fade-to-black overlay in the final outro layer.
- `add_outro_focus_area` optional boolean; requires `add_outro_animation` and valid `outro_focust_area`.
- `outro_focust_area` optional; `{ x, y, width, height }`, validated against the session canvas.
- Behavior:
  - If the last layer is already the outro, it replaces that outro.
  - If the last layer is not an outro, it appends a new outro layer.
  - In both cases, a `0.5s` fade-in transition of the outro image is applied to the end of the prior layer so it leads into the outro start frame.
- Credits are billed at **75 credits per request**.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/add_outro_image \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4",
      "outro_image_url": "https://cdn.example.com/outro.png",
      "add_outro_animation": true,
      "add_outro_focus_area": true,
      "outro_focust_area": { "x": 240, "y": 140, "width": 720, "height": 420 }
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Sample request: add generated CTA image outro**

```bash
curl -X POST https://api.samsar.one/v1/video/add_outro_image \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4",
      "generate_outro_image": true,
      "outro_cta_image": {
        "top_text": "Shop the drop",
        "middle_image": { "url": "https://cdn.example.com/drop-logo.png" },
        "bottom_text": "Limited availability"
      }
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_outro_a1b2c3",
  "session_id": "vid_outro_a1b2c3"
}
```

**Error responses**

- `400` invalid or missing fields.
- `401` invalid API key.
- `402` insufficient credits.
- `404` session not found.

## POST /video/update_outro_image

Clone an existing session that already has an outro layer, update that outro layer, and queue only the frame/video regeneration stages. This route does not rerun prompt, image, speech, music, or AI video generation.

Use one of two modes:

- Provided outro image mode: pass `outro_image_url` (or `outroImageUrl`, `new_outro_image_url`, `newOutroImageUrl`) as an HTTP(S) URL or image data URL.
- Generated CTA outro mode: pass `generate_outro_image: true` with either `cta_url` or `outro_cta_image`, or provide `cta_url` / `outro_cta_image` without an `outro_image_url`. With `cta_url`, Samsar builds a QR-code outro. With `outro_cta_image`, Samsar places the supplied logo/CTA image in the same center area, resized without changing aspect ratio. In both cases it derives the focus area server-side and keeps optional top/bottom CTA text above the fade overlay.

**Provided outro image request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "outro_image_url": "https://cdn.example.com/outro.png",
    "add_outro_animation": true,
    "add_outro_focus_area": true,
    "outro_focust_area": { "x": 240, "y": 140, "width": 720, "height": 420 }
  },
  "webhookUrl": "https://example.com/webhook"
}
```

**Generated CTA outro request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "generate_outro_image": true,
    "cta_url": "https://example.com/book",
    "cta_text_top": "Scan to book",
    "cta_text_bottom": "Limited availability",
    "add_outro_animation": true
  },
  "webhookUrl": "https://example.com/webhook"
}
```

**Generated CTA image outro request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "generate_outro_image": true,
    "outro_cta_image": {
      "top_text": "Shop the drop",
      "middle_image": { "url": "https://cdn.example.com/drop-logo.png" },
      "bottom_text": "Limited availability"
    }
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `videoSessionId` required; must belong to the API key.
- `outro_image_url` required unless `generate_outro_image` is true.
- `generate_outro_image` optional boolean; when true, `cta_url` or `outro_cta_image` is required and `outro_image_url` must be omitted. If `cta_url` or `outro_cta_image` is provided without `outro_image_url`, generated CTA outro mode is inferred.
- `cta_url` optional for generated CTA outro mode; must be HTTP(S). It is converted into a scannable QR code.
- `outro_cta_image` optional for generated CTA outro mode; uses `{ "top_text", "middle_image", "bottom_text" }`. `middle_image` accepts a public URL (`{ "url" }`, `{ "image_url" }`) or image data (`{ "data_url" }`, `{ "image_data", "mime_type" }`).
- `cta_text_top` optional; rendered near the top of the outro layer above the fade overlay.
- `cta_text_bottom` optional; rendered near the bottom of the outro layer above the fade overlay.
- `cta_logo` optional and accepted for compatibility with QR generated-outro requests.
- `add_outro_animation` optional boolean. In generated CTA outro mode it defaults to true; when true, Samsar adds a black overlay that fades from 60% opacity to 0% while the generated center image and CTA text stay above it.
- `add_outro_focus_area` optional for provided outro image mode; requires `add_outro_animation` and valid `outro_focust_area`. Generated CTA outro mode calculates the focus area server-side.
- Credits are billed at **75 credits per request**.

**Sample request: update with generated CTA outro**

```bash
curl -X POST https://api.samsar.one/v1/video/update_outro_image \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4",
      "generate_outro_image": true,
      "cta_url": "https://example.com/book",
      "cta_text_top": "Scan to book",
      "cta_text_bottom": "Limited availability"
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_outro_update_a1b2c3",
  "session_id": "vid_outro_update_a1b2c3"
}
```

## POST /video/update_footer_image

Clone an existing video session, update or remove the scene footer CTA, and queue only footer image creation when needed plus frame/video regeneration. This route does not rerun prompt, image, speech, music, or AI video generation.

Use `remove_footer: true` to remove the footer from all scenes in the cloned rerender. Otherwise provide at least one CTA field and Samsar applies the same minimal footer layout to each scene.

**Update footer request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "cta_text": "Scan to book",
    "cta_logo": "https://cdn.example.com/logo-white.png",
    "cta_url": "https://example.com/book"
  },
  "webhookUrl": "https://example.com/webhook"
}
```

**Remove footer request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "remove_footer": true
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `videoSessionId` required; must belong to the API key.
- `remove_footer` optional boolean; defaults to false. When true, `cta_text`, `cta_logo`, and `cta_url` are ignored and all scene footer metadata is cleared.
- `cta_text` optional string; rendered in the bottom-left footer area.
- `cta_logo` optional HTTP(S) URL or image data URL; rendered below the CTA text in the bottom-left footer area.
- `cta_url` optional HTTP(S) URL; converted into a scannable QR code on the right side of the footer.
- At least one of `cta_text`, `cta_logo`, or `cta_url` is required unless `remove_footer` is true.
- Credits are billed at **75 credits per request**.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/update_footer_image \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4",
      "cta_text": "Scan to book",
      "cta_logo": "https://cdn.example.com/logo-white.png",
      "cta_url": "https://example.com/book"
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_footer_update_a1b2c3",
  "session_id": "vid_footer_update_a1b2c3"
}
```

## POST /external_users/add_outro_image

External-user equivalent of `/video/add_outro_image`. Pass the external user identity and an external request/session id such as `extreq_df04419ab0cf426e9b30891da71a9293`; Samsar resolves it to the upstream video session, charges the external user's credits, clones the session, and queues only frame/video regeneration.

**Request body**

```json
{
  "external_user": {
    "provider": "guidestination",
    "external_user_id": "traveler_123"
  },
  "input": {
    "request_id": "extreq_df04419ab0cf426e9b30891da71a9293",
    "outro_image_url": "https://cdn.example.com/outro.png",
    "add_outro_animation": true,
    "add_outro_focus_area": true,
    "outro_focust_area": { "x": 240, "y": 140, "width": 720, "height": 420 }
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `request_id` / `session_id` required; use the external request id returned by `/external_users/text_to_video` or `/external_users/image_list_to_video`.
- Supports the same provided-outro and generated CTA outro modes as `/video/add_outro_image`.
- Generated CTA outro mode accepts `cta_url` for a QR center image or `outro_cta_image` for a supplied center logo/CTA image.
- `add_outro_animation`, `add_outro_focus_area`, and `outro_focust_area` match `/video/add_outro_image`.
- Credits are billed at **75 credits per request** against the external user.

## POST /external_users/update_outro_image

External-user equivalent of `/video/update_outro_image`. Use this endpoint when the source video was created through `/external_users/text_to_video` or `/external_users/image_list_to_video`; pass either the returned `extreq_...` id or the normalized external id.

**Generated CTA outro request body**

```json
{
  "external_user": {
    "provider": "guidestination",
    "external_user_id": "traveler_123"
  },
  "input": {
    "request_id": "extreq_df04419ab0cf426e9b30891da71a9293",
    "generate_outro_image": true,
    "outro_cta_image": {
      "top_text": "Shop the drop",
      "middle_image": { "url": "https://cdn.example.com/drop-logo.png" },
      "bottom_text": "Limited availability"
    },
    "add_outro_animation": true
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `request_id` / `session_id` required; use the external request id returned by an external-user video route.
- Supports the same provided-outro and generated CTA outro modes as `/video/update_outro_image`.
- Generated CTA outro mode accepts `cta_url` for a QR center image or `outro_cta_image` for a supplied center logo/CTA image, then derives `add_outro_focus_area` and `outro_focust_area` server-side.
- Credits are billed at **75 credits per request** against the external user.

**Success response (200)**

```json
{
  "request_id": "extreq_9b30891da71a9293df04419ab0cf426e",
  "session_id": "extreq_9b30891da71a9293df04419ab0cf426e",
  "external_request_id": "extreq_9b30891da71a9293df04419ab0cf426e",
  "status_endpoint": "/v1/external_users/status?request_id=extreq_9b30891da71a9293df04419ab0cf426e",
  "creditsCharged": 75
}
```

## POST /external_users/update_footer_image

External-user equivalent of `/video/update_footer_image`. Use this endpoint when the source video was created through `/external_users/text_to_video` or `/external_users/image_list_to_video`; pass either the returned `extreq_...` id or the normalized external id.

**Request body**

```json
{
  "external_user": {
    "provider": "guidestination",
    "external_user_id": "traveler_123"
  },
  "input": {
    "request_id": "extreq_df04419ab0cf426e9b30891da71a9293",
    "cta_text": "Scan to book",
    "cta_logo": "https://cdn.example.com/logo-white.png",
    "cta_url": "https://example.com/book"
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `request_id` / `session_id` required; use the external request id returned by an external-user video route.
- Supports the same `remove_footer`, `cta_text`, `cta_logo`, and `cta_url` fields as `/video/update_footer_image`.
- Credits are billed at **75 credits per request** against the external user.

**Success response (200)**

```json
{
  "request_id": "extreq_9b30891da71a9293df04419ab0cf426e",
  "session_id": "extreq_9b30891da71a9293df04419ab0cf426e",
  "external_request_id": "extreq_9b30891da71a9293df04419ab0cf426e",
  "status_endpoint": "/v1/external_users/status?request_id=extreq_9b30891da71a9293df04419ab0cf426e",
  "creditsCharged": 75
}
```

## POST /video/clone

Deep-copy a completed video session into a new session and queue only the final video render stage. Use this when you need a distinct session id and a distinct rendered video URL, but the same timeline, resources, audio, overlays, subtitle settings, footer/outro metadata, and generated assets.

`POST /v2/video/clone` exposes the same operation on the V2 route surface.

**Request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4"
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `videoSessionId` required; must be a completed video session that belongs to the authenticated user.
- The clone copies the source session data and local generated resources into the new session.
- Upstream generation stages are marked complete; only `video_generation` is queued so the renderer creates a new `video/output/video-<new_session_id>_*.mp4` file and new CDN URL.
- This endpoint currently does not charge additional credits.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/clone \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4"
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_clone_a1b2c3",
  "session_id": "vid_clone_a1b2c3",
  "status": "PENDING",
  "type": "video",
  "creditsCharged": 0
}
```

Poll `GET /status?request_id=<new_session_id>` or `GET /v2/status?request_id=<new_session_id>` until the standard video status response returns `status: "COMPLETED"` with `result_url`, `result_urls`, `has_subtitles`, and `result_language`.

**Error responses**

- `400` invalid/missing fields or source session has no completed video URL
- `401` invalid API key
- `404` session not found

## POST /video/reroll-layers

Reroll selected 1-based layers in an owned completed video session. The selected layers restart at image generation, then AI-video and lip-sync/sound-effect work runs as needed for those layers. Frame generation, generated outro tiles when present, and final video generation rerun for the whole session.

`POST /v2/reroll-layers` and `POST /v2/video/reroll-layers` expose the same operation on the V2 route surface.

**Request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "layer_indexes": [3, 6, 11]
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `videoSessionId` required; must be a video session that belongs to the authenticated user and is not currently rendering.
- `layer_indexes` required; accepts positive 1-based layer indexes.
- The route updates the same session in place and does not clone the video.
- Quote-only requests with `quote_only: true` return the credit estimate without charging or queuing work.

**Quote-only request**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "layer_indexes": [3, 6],
    "quote_only": true
  }
}
```

**Success response (200)**

```json
{
  "request_id": "vid_a1b2c3d4",
  "session_id": "vid_a1b2c3d4",
  "status": "PENDING",
  "layer_indexes": [3, 6, 11],
  "creditQuote": {
    "layerCount": 3,
    "totalCredits": 164,
    "imageCredits": 92,
    "aiVideoCredits": 72
  },
  "creditsCharged": 164
}
```

**Error responses**

- `400` invalid/missing fields, unsupported layer indexes, or missing image prompts
- `401` invalid API key
- `402` insufficient credits
- `404` session not found
- `409` session is currently rendering or paused

## POST /video/translate_video

Translate an existing video session into a new language. This creates a new session and runs only the required stages (speech translation, lip sync, optional transcription, final render) to produce a translated video.

`POST /video/retranslate_video` is available as an alias for the same operation.

**Request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4",
    "language": "en | es | fr | ja | th | zh | bn | hi | sa | la",
    "enable_subtitles": false,
    "translate_outro": true,
    "translate_footer": true,
    "inference_model": "gpt-6-astra",
    "effort": "high"
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `videoSessionId` required; must be a video session that belongs to the API key.
- `language` required; pass a supported language code.
- `enable_subtitles` optional boolean; defaults to `false`. When `true`, Samsar generates translated transcript/subtitle text for the cloned session.
- `translate_outro` optional boolean; defaults to `true`. When enabled, stored generated-outro top and bottom CTA text are translated and reused in the cloned outro.
- `translate_footer` optional boolean; defaults to `true`. When enabled, stored footer CTA text is translated per footer-enabled layer and reused in the cloned footer overlay.
- `inference_model` and `effort` optionally override the account's selected inference model and reasoning effort for translation. Translation uses the selected model before speech is synthesized.
- `outro_image_url` is no longer part of the translate payload. Use `POST /video/update_outro_image` before or after translation when the outro image itself needs to change.
- Credits are billed at **3 credits/sec** using the duration of the source session.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/translate_video \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4",
      "language": "es",
      "enable_subtitles": false,
      "translate_outro": true,
      "translate_footer": true
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_tr_a1b2c3",
  "session_id": "vid_tr_a1b2c3"
}
```

**Error responses**

- `400` invalid/missing fields (unknown session id, unsupported language, etc.)
- `401` invalid API key
- `402` insufficient credits

## POST /video/join_videos

Join multiple completed video sessions into a single session by appending their timelines in order. This creates a new session and queues transcription, frame generation, and final render to produce the joined video.

**Request body**

```json
{
  "input": {
    "session_ids": ["vid_a1b2c3d4", "vid_e5f6g7h8"],
    "blend_scenes": true
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `session_ids` required; array of **2+** unique video session ids.
- `blend_scenes` optional boolean (default `false`). When `true`, joins apply scene-boundary blending:
  previous outro image is carried into the next scene with a 1s fade-out, and background music layers are adjusted around boundaries (`+0.5s`) for smoother transitions.
- All sessions must belong to the API key, and must have the same `aspect_ratio` and `framesPerSecond`.
- Credits are billed at **3 credits/sec** using the joined duration (sum of session durations).

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/join_videos \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "session_ids": ["vid_a1b2c3d4", "vid_e5f6g7h8"],
      "blend_scenes": true
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_join_a1b2c3",
  "session_id": "vid_join_a1b2c3"
}
```

**Error responses**

- `400` invalid/missing fields (unknown session id, incompatible sessions, etc.)
- `401` invalid API key
- `402` insufficient credits
- `404` one or more sessions not found

## POST /video/remove_subtitles

Clone an existing session, remove all subtitle/transcript text overlays (`type: "text"` items in layer `activeItemList`), and queue only frame + video generation for the new session.

**Request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4"
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `videoSessionId` required; must be a video session that belongs to the API key.
- Creates a new `session_id`; the source session remains unchanged.
- The cloned session is configured to skip transcription and other generation stages, and run only frame/video generation.
- This endpoint currently does not charge additional credits.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/remove_subtitles \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4"
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_nosub_a1b2c3",
  "session_id": "vid_nosub_a1b2c3"
}
```

**Error responses**

- `400` invalid/missing fields (invalid session id format, missing session id, etc.)
- `401` invalid API key
- `404` session not found

## POST /video/add_subtitles

Clone an existing session, add subtitle/transcript text overlays, and queue the stages required to produce a subtitled video in a new session.

**Request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4"
  },
  "webhookUrl": "https://example.com/webhook"
}
```

- `videoSessionId` required; must be a video session that belongs to the API key.
- Creates a new `session_id`; the source session remains unchanged.
- The cloned session is saved with `has_subtitles: true` and preserves the session language/aspect ratio.
- This endpoint currently does not charge additional credits.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/add_subtitles \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4"
    },
    "webhookUrl": "https://example.com/video-webhook"
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_sub_a1b2c3",
  "session_id": "vid_sub_a1b2c3"
}
```

**Error responses**

- `400` invalid/missing fields (invalid session id format, missing session id, etc.)
- `401` invalid API key
- `404` session not found

## POST /video/cancel_render

Cancel an in-progress render for an existing session. This sets the session to a cancelled state and stops queued render tasks for that session.

**Request body**

```json
{
  "input": {
    "videoSessionId": "vid_a1b2c3d4"
  }
}
```

- `videoSessionId` required; must belong to the API key.
- This endpoint does not create a new session.
- This endpoint currently does not charge additional credits.

**Sample request**

```bash
curl -X POST https://api.samsar.one/v1/video/cancel_render \
  -H "Authorization: Bearer $SAMSAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "videoSessionId": "vid_a1b2c3d4"
    }
  }'
```

**Success response (200)**

```json
{
  "request_id": "vid_a1b2c3d4",
  "session_id": "vid_a1b2c3d4",
  "status": "CANCELLED",
  "cancelled": true,
  "message": "Render cancellation requested."
}
```

**Error responses**

- `400` invalid/missing session id
- `401` invalid API key
- `404` session not found

## GET /video/fetch_latest_version

Fetch the latest available render URL for a given video `session_id`.

**Request**

```bash
curl "https://api.samsar.one/v1/video/fetch_latest_version?session_id=vid_a1b2c3d4" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Completed (200)**

```json
{
  "session_id": "vid_a1b2c3d4",
  "result_url": "https://cdn.samsar.one/videos/vid_a1b2c3d4.mp4",
  "has_subtitles": true,
  "result_language": "en"
}
```

- `has_subtitles` is `true`, `false`, or `null` when subtitle state is unknown for older sessions.
- `result_language` is the language code saved on the video session.

**Pending (202)**

```json
{
  "session_id": "vid_a1b2c3d4",
  "status": "PENDING",
  "message": "Render not ready yet."
}
```

**Failed (200)**

```json
{
  "session_id": "vid_a1b2c3d4",
  "status": "FAILED",
  "message": "Video generation failed."
}
```

**Cancelled (200)**

```json
{
  "session_id": "vid_a1b2c3d4",
  "status": "CANCELLED",
  "message": "Render was cancelled."
}
```

**Error responses**

- `400` missing/invalid `session_id`
- `401` invalid API key
- `403` session does not belong to the API key
- `404` session not found

## GET /video/list_completed_video_sessions

List completed video sessions for the authenticated API key, including each session language and final URL.

**Request**

```bash
curl "https://api.samsar.one/v1/video/list_completed_video_sessions" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

Optional query params:

- `limit` (number): maximum number of sessions to return (server-capped to `5000`).

**Success response (200)**

```json
[
  {
    "session_id": "vid_a1b2c3d4",
    "langauge": "en",
    "result_language": "en",
    "has_subtitles": true,
    "result_url": "https://static.samsar.one/video/vid_a1b2c3d4/final.mp4"
  },
  {
    "session_id": "vid_e5f6g7h8",
    "langauge": "es",
    "result_language": "es",
    "has_subtitles": false,
    "result_url": "https://static.samsar.one/video/vid_e5f6g7h8/final.mp4"
  }
]
```

- Returns only sessions that have a final video URL available.
- `langauge` is returned as a normalized language code (lowercase).
- `result_language` is the same normalized language code returned with the corrected field name.
- `has_subtitles` is `true`, `false`, or `null` when subtitle state is unknown for older sessions.

**Error responses**

- `400` missing API key/auth header
- `401` invalid API key

## GET /status

Poll the status for any `request_id` returned by the video endpoints (or `/image/*` endpoints).

**Request**

```bash
curl "https://api.samsar.one/v1/status?request_id=vid_a1b2c3d4" \
  -H "Authorization: Bearer $SAMSAR_API_KEY"
```

**Queued / processing**

```json
{
  "session_id": "vid_a1b2c3d4",
  "request_id": "vid_a1b2c3d4",
  "status": "PENDING",
  "type": "video",
  "provider": "RUNWAYML",
  "expressGenerationStatus": {
    "prompt_generation": "PENDING",
    "video_generation": "IN_PROGRESS"
  }
}
```

**Completed**

```json
{
  "session_id": "vid_a1b2c3d4",
  "request_id": "vid_a1b2c3d4",
  "status": "COMPLETED",
  "type": "video",
  "provider": "RUNWAYML",
  "result_url": "https://cdn.samsar.one/videos/vid_a1b2c3d4.mp4",
  "result_urls": [
    "https://cdn.samsar.one/videos/vid_a1b2c3d4.mp4"
  ],
  "has_subtitles": true,
  "result_language": "en",
  "videoLink": "https://cdn.samsar.one/videos/vid_a1b2c3d4.mp4",
  "remoteURL": "https://cdn.samsar.one/videos/vid_a1b2c3d4.mp4"
}
```

- `result_urls` may be present when multiple assets are produced; `videoLink` or `remoteURL` can also contain the download URL.
- Completed video responses include `has_subtitles` and `result_language` when session metadata is available.
- `expressGenerationStatus` is present while individual stages are running; `expressGenerationError`/`message` is present on failure.
- `404` is returned when the `request_id` is unknown; `401` when the API key is invalid.

## GET /supported_fonts

Fetch the supported subtitle fonts by language code. Use this to validate `font_key` or text overlay choices before submitting video requests. This endpoint does not require authentication.

**Request**

```bash
curl "https://api.samsar.one/v1/supported_fonts"
```

**Success response (200)**

```json
{
  "fontsByLanguage": {
    "default": ["Rampart One", "Montserrat", "Arial", "sans-serif"],
    "en": ["Poppins", "Montserrat", "Arial", "sans-serif"],
    "ja": ["Noto Sans JP", "M PLUS Rounded 1c", "Hiragino Sans", "Yu Gothic UI", "sans-serif"],
    "ko": ["Noto Sans KR", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"]
  }
}
```

- `default` is used when a language code has no explicit mapping.
- Font previews: visit [`/fonts`](/fonts) for light/dark samples with keys.

## V2 API

The `/v2` omni routes now live in [V2 API](/v2), with left-nav sections for authentication, user credits, app keys, media generation, assistant utilities, status, and publishing routes. Reusable singular and branched narrative generation is documented in the [Narrative API](/narrative), including the route that starts media rendering from a completed `NarrativeRequest`.

### GPT and Claude effort

For GPT 6 Astra, GPT 6.1 Sol, Claude Opus 5.5, and Claude Fable 5.1, pass `effort: "high"` or `effort: "xhigh"` alongside `inference_model`. Both text inference and vision use the selected model and effort. Existing account defaults remain unchanged; the default is GPT 6 Astra at `high`.


<a id="document-c88f01d6e694d39ce19e291ceebf4c64"></a>
## Blog integration: BLOG_SETUP.md

Source class: project_docs; audience: operator; freshness: current.

Sources: repo:samsar_blog/BLOG_SETUP.md

# Samsar Blog Setup

## Runtime

- Ghost canonical URL should be `https://samsar.one/blog/`
- Keep `API_HOST=https://api.samsar.one/v1`
- Set `API_KEY` in the Ghost runtime environment
- Set `SAMSAR_AUTH_API_URL=http://processor:3002` in the production Compose network
- Set `SAMSAR_AUTH_COOKIE_DOMAIN=.samsar.one` in production
- Set `SAMSAR_BLOG_AUTH_CALLBACK_URL=https://samsar.one/blog/members/api/samsar-auth/google/verify` on the processor
- Keep Ghost database credentials in the live `config.production.json` or deployment environment, not in this repository

## Reader authentication

The Samsar theme excludes Ghost Portal and uses the same email/password and
Google sign-in flow as Samsar Studio. Requests go through the same-origin Ghost
bridge at `/blog/members/api/samsar-auth`; the bridge calls the Samsar processor,
then creates or resumes the corresponding Ghost member session for comments and
post reactions.

Post likes use the overlay-owned
`/members/api/samsar-auth/post-likes/:post_id` endpoint. Positive rows in Ghost's
existing `members_feedback` table provide the per-member like state and public
count, so the official production Ghost runtime does not depend on a custom
database migration. Sending `POST` likes the post and `DELETE` unlikes it.

Google OAuth returns to the bridge-owned `/google/verify` route with an opaque,
short-lived handoff code. The server exchanges that code once and requires the
browser-bound nonce created when sign-in began, so a reusable Samsar bearer token
never appears in a callback URL. Only local `/blog` return paths are accepted
before the original article is restored. Email and Google registrations both
create standard Samsar users with zero generation credits.

## Transactional Mail

Ghost admin password reset uses Ghost transactional mail. Production SMTP and
SES credentials are managed in the protected `samsar-production` runtime
environment and provided to the blog container during centralized deployment.
The resulting Ghost mail configuration uses:

- `mail.transport=SMTP`
- `mail.options.host=email-smtp.<region>.amazonaws.com`
- `mail.options.port=465`
- `mail.options.secure=true`
- `mail.from=<SES_FROM_ADDRESS or default>`

Do not store production SMTP credentials in this source repository.

## Traffic Analytics

Ghost only injects the `ghost-stats.min.js` tracker when both conditions are true:

- the `web_analytics` setting is enabled in the Ghost database
- Tinybird traffic analytics config is present in the Ghost runtime config

The production service must provide:

```bash
tinybird__tracker__endpoint=<traffic analytics ingest endpoint>
tinybird__stats__endpoint=<Tinybird API endpoint>
tinybird__workspaceId=<workspace id>
tinybird__adminToken=<admin token>
```

For a local Tinybird stats setup, `tinybird__stats__local__enabled=true` and `tinybird__stats__local__token=<token>` can be used instead of the workspace/admin token pair.

After deployment, verify injection with:

```bash
npm run check:analytics -- https://www.samsar.one/blog/
```

The check should report `analyticsHeader: "true"`, `hasTrackerScript: true`, and `hasTrackerHost: true`.

## Theme

- Activate the `samsar` theme from `ghost/core/content/themes/samsar`
- The theme includes a landing-style home page and a built-in text enhancement widget
- The widget posts to `POST /members/api/samsar/enhance-text`

## CloudFront and S3 split

`landing` remains the S3 static origin for the main site, but `/blog` cannot be served from S3 because Ghost is dynamic.

Configure CloudFront so:

- default behavior points to the existing `landing` S3 origin
- `/blog` points to the Ghost origin
- `/blog/*` points to the Ghost origin

The Ghost origin should receive the request path unchanged so the site URL subdirectory stays `/blog`.

## Landing links

All public blog links in `landing` should use `https://www.samsar.one/blog/` or the generated blog metadata manifest.


<a id="document-e84cbb96df5caed6e2b54fb67f642719"></a>
## Blog integration: README.md

Source class: project_docs; audience: operator; freshness: current.

Sources: repo:samsar_blog/README.md

# Samsar Blog

Minimal Ghost fork used by the Samsar production integration.

## What is kept

- `ghost/core`: Ghost server runtime and content
- `ghost/admin`: Ghost admin source/assets
- `ghost/i18n`: workspace package required by Ghost core
- `ghost/parse-email-address`: workspace package required by Ghost core
- custom Samsar integration and `samsar` theme under `ghost/core`

## What was removed

- monorepo tooling and CI metadata
- docs, e2e, scripts, editor-specific folders, and apps that are not required for production builds
- test suites and several dev-only config files

## Local install

```bash
pnpm run install:blog
API_KEY=your_key \
API_HOST=https://api.samsar.one/v1 \
SAMSAR_AUTH_API_URL=https://api.samsar.one \
pnpm start
```

## Production configuration

Use:

- `API_KEY` from environment
- `API_HOST=https://api.samsar.one/v1`
- `SAMSAR_AUTH_API_URL=http://processor:3002` inside the production Compose network
- `SAMSAR_AUTH_COOKIE_DOMAIN=.samsar.one` for consented cross-application sign-in
- processor callback `SAMSAR_BLOG_AUTH_CALLBACK_URL=https://samsar.one/blog/members/api/samsar-auth/google/verify`
- Ghost URL `https://samsar.one/blog/`

The theme uses Samsar email/password and Google authentication instead of
Ghost Portal. The server verifies each Samsar token, creates the matching Ghost
member needed for comments and reactions, and returns the reader to the exact
blog path where authentication began. New registrations use the normal Samsar
account endpoint, whose starting generation-credit balance is zero. Google uses
a browser-bound nonce and a short-lived, single-use server exchange; a Samsar
bearer token is never placed in the browser callback URL.

Production runtime configuration and secrets are owned by the sibling
`samsar-production` integration. To synchronize all source projects and deploy
the affected services, run this from the `samsar_one` workspace root:

```bash
./samsar-production-deployer.sh
```

Do not commit local config files, production environment files, or database
passwords to this repository.

See [BLOG_SETUP.md]([local-workspace-path]).


<a id="document-c5e4ebf15f0b5858b2a809c32c9b030e"></a>
## Architecture

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

Samsar is organized as a deployable Docker mono-repo. The top-level `samsar` package is the wrapper that syncs source projects into `apps/*` and `services/*`, renders runtime configuration, and starts the Compose stack.

Start with [hosted Samsar.js](https://docs.samsar.one/) if you want managed workflows. This page describes the standalone architecture used when you deploy those workflows yourself. Follow the [model matrix](model-matrix.md) into [provider configuration](providers-and-models.md) to choose compatible adapters. The client API contract remains documented at [docs.samsar.one](https://docs.samsar.one/v2).


<a id="document-01533664e2f4e317e646f0495ca5652d"></a>
## Architecture > Assistant Billing and Recovery

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

Session assistant APIs, public chat/assistant APIs, and hosted queued assistant requests use the [final token prices](assistant-billing.md#final-token-prices) for the listed model and adapter routes. Production agent pipeline inference keeps its flat stage pricing. The standalone Studio assistant worker retains its local-credit waiver; hosted API calls made through a Samsar adapter still incur the hosted endpoint charge.

Reuse the same request key when retrying. Completed replays return the original response and charge without another debit. Requests awaiting billing confirmation or completion after a timeout can remain pending; continue checking the existing request. See [Assistant billing and retries](assistant-billing.md) for the client contract and verification commands.


<a id="document-de17fa9be10d8c110041c0efe77915c9"></a>
## Architecture > Compose Profiles

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

| Profile | Services | Role |
| --- | --- | --- |
| `core` | `client`, `processor` | Browser app and API. |
| `workers` | `generator`, `audio-generator`, `frames-processor`, `video-generator`, `ai-video-layer-generator`, `express-video-listener`, `assistant-query-processor`, `task-processor` | Async media and assistant work. |
| `local-mongo` | `mongo` | Local MongoDB for users, sessions, requests, credits, embeddings, and status records. |
| `minio` | `minio` | Local S3-compatible media bucket. |
| `local-media` | `media-gateway` | Nginx gateway for `/assets` and `/assets_v2`. |
| `logger` | `loki`, `promtail`, `grafana` | Local container log collection and dashboarding. |
| `reverse-proxy` | `reverse-proxy` | Optional public or intranet nginx entrypoint for Studio and the processor API on ports `80` and `443`. |


<a id="document-8bcd0ba6a9f7da2d0b130eb6fab91209"></a>
## Architecture > Deployment Modes

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

| Mode | When to use | Notes |
| --- | --- | --- |
| Docker Compose | Default local install and demos | Uses local Mongo, MinIO, media gateway, and local logs unless configured otherwise. |
| Bare-metal local | Service-level development | Source Node services run on the host; Mongo/MinIO/media gateway can still run in Docker. |
| Kubernetes | Cluster deployment planning | Helm chart scaffold lives under `deploy/helm/samsar`; production templates, probes, ingress, PVCs, ConfigMaps, and Secrets still need to be added before real use. |


<a id="document-b97ca669f7dc6cda80de4d12902e3977"></a>
## Architecture > Observability

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

The logger profile starts Loki, Promtail, and Grafana. Grafana is available only on loopback at `http://localhost:4000` by default and requires the generated administrator credentials from `runtime/secrets/grafana.env`.

Useful log command:

```bash
docker compose -f deploy/compose/docker-compose.yml logs -f processor express-video-listener video-generator
```


<a id="document-a108eb3d6b028ea0a4c9252e48193aa0"></a>
## Architecture > Provider Calls

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

Provider credentials are loaded from `root.env`. In standalone Docker, inference uses each model’s compatible provider chain and saved model-adapter preferences. Native inference can take precedence, with Samsar.js and optional mapped providers available according to the model registry. Qwen is the exception in hosted deployments: `production`, `external-production`, `staging`, and other non-Docker runtimes always route `QWEN3.8` through `OPENROUTER_API_KEY`, regardless of saved provider provenance or an available Alibaba credential. Native Alibaba Qwen is allowed only when `CURRENT_ENV=docker`; `SAMSAR_QWEN_OPENROUTER_ONLY=true` can force the hosted rule in Docker.

The processor, generator, audio generator, AI video layer generator, express video listener, and assistant query processor use the same inference-adapter policy. OpenRouter Qwen text and vision requests map to `qwen/qwen3.8-max`; native Alibaba text and vision use `qwen3.8-max`. In Docker, a validated Alibaba Token Plan endpoint sets the shared `ALIBABA_QWEN_MODEL=qwen3.8-max` override. `ALIBABA_QWEN_TEXT_MODEL` is emitted with the same value only for rolling-container compatibility.


<a id="document-d3d84aa388e270c5b419f1f5d0d358cc"></a>
## Architecture > Request Flow

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

1. Studio or an API client calls the processor API on `http://localhost:3002`.
2. The processor validates auth, credits, request shape, and model availability.
3. The processor writes session/request state to MongoDB and stores media in MinIO or the configured external S3-compatible store.
4. Workers pick up queued work through MongoDB-backed state and provider-specific task records.
5. Media outputs are written to Docker volumes and served to browsers through the configured processor API (`http://localhost:3002` by default), or through its optional reverse proxy URL. The internal `media-gateway` is used only as the origin for provider tunnels.
6. Clients poll status endpoints, subscribe to supported assistant SSE streams, or receive webhook callbacks where provided by the operation.


<a id="document-774a5dacd9177b1e528e0424ed23f446"></a>
## Architecture > Runtime Config

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

The primary runtime file is `runtime/config/samsar.config.json`. It is copied from `samsar.config.example.json` for local setup and edited manually or through the setup wizard.

`npm run config:render` generates:

| File | Purpose |
| --- | --- |
| `runtime/secrets/root.env` | Env file consumed by Docker services. Contains provider keys, DB/storage settings, public URLs, mail settings, and generated setup values. |
| `runtime/secrets/application.env` | Durable generated application signing and custom-adapter encryption secrets. |
| `runtime/secrets/mongo.env` | Durable generated local MongoDB root and application credentials. |
| `runtime/secrets/minio.env` | Durable generated local MinIO administrator credentials. |
| `runtime/secrets/grafana.env` | Durable generated Grafana administrator credentials. |
| `runtime/config/available-models.json` | Provider/model/action availability derived from enabled providers. Used by the API to filter public model responses. |

The `runtime/` directory is gitignored because it contains local credentials and generated deployment state.


<a id="document-2f382e0cb1e9bf4e0c5192ef5508cc35"></a>
## Architecture > Runtime Shape

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

The default Docker deployment keeps the Studio client, processor API, workers, local infrastructure, and optional logging inside the Compose runtime. The client uses REST and assistant SSE streams; the processor and workers consume rendered configuration, persist state through MongoDB, and write media through the configured object storage adapter.


<a id="document-03e4f70817fea0944eea695e2e5b5dad"></a>
## Architecture > Storage and Media

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/architecture.md

Local Docker defaults to:

| Setting | Default |
| --- | --- |
| Database | Authenticated MongoDB at `mongo:27017`, using generated application credentials and `authSource=admin` |
| Object storage | MinIO at `http://minio:9000` |
| Bucket | `samsar-resources` |
| Browser media base | `http://localhost:3002/` |
| Secure asset prefix | `assets_v2` |

Completed local render URLs normally look like:

```text
http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

External S3-compatible storage can be selected in the setup wizard or configured directly in `runtime/config/samsar.config.json`. When external media publishing is enabled, provider-visible URLs come from `storage.staticCdnUrl`.

The Docker reverse proxy controls browser-facing Studio and processor/media URLs. Public/private IP installs use one machine IP: Studio is served at `http://<ip>` and the processor/media base is `http://<ip>/api`. External adapter requests use the separately managed media tunnel whenever external S3/CloudFront publishing is disabled.


<a id="document-87d89ac03914627e0005c3071b49e794"></a>
## Assistant Billing and Retries

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/assistant-billing.md

Assistant and public chat/assistant endpoints use the final customer token prices below. Production agent pipeline inference retains its flat stage pricing.


<a id="document-800f03a831ca2fd6243c05f0d56012df"></a>
## Assistant Billing and Retries > Credit Balances

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/assistant-billing.md

The authenticated billing scope determines which balance pays. Standard external users use their allocated external balance. Internal-mapped external users debit the owning internal account; a configured customer sub-account budget is also consumed once as a spending limit. That budget is not a second charge to the internal balance. API-key attribution is retained for queued settlement and recovery.

A positive balance and sufficient API-key allowance are required before a request starts. The final charge can exceed the available balance; further requests are rejected until credits are restored.


<a id="document-1f2def242e040688f98039c3dde72661"></a>
## Assistant Billing and Retries > Final Token Prices

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/assistant-billing.md

All prices are **credits per one million tokens**. Each row applies to the specified model, adapter, context, and date period. Date periods use UTC. Cached input means cached-read tokens. These tables cover model tokens; separately priced tools have their own charges.

| Model | Adapter | Context / date period | Input | Cached input | Output |
| --- | --- | --- | ---: | ---: | ---: |
| `gpt-6-astra` | OpenAI | ≤ 272k input tokens | 1,200 | 120 | 6,000 |
| `gpt-6-astra` | OpenAI | > 272k input tokens | 2,400 | 240 | 9,000 |
| `gpt-6.1-sol` | OpenAI | ≤ 272k input tokens | 240 | 12 | 1,200 |
| `gpt-6.1-sol` | OpenAI | > 272k input tokens | 480 | 24 | 1,800 |
| `claude-opus-5.5` | Anthropic | Standard | 480 | 24 | 2,400 |
| `claude-fable-5.1` | Anthropic / OpenRouter | Standard | 1,200 | 30 | 6,000 |
| `gemini-4-argon` | Google global | Through Nov 30, 2026 | 240 | 12 | 1,200 |
| `gemini-4-argon` | Google global | From Dec 1, 2026 | 480 | 24 | 2,400 |
| `gemini-4-argon` | Google regional | Through Nov 30, 2026 | 264 | 13.2 | 1,320 |
| `gemini-4-argon` | Google regional | From Dec 1, 2026 | 528 | 26.4 | 2,640 |
| `QWEN3.8` | Alibaba international | Standard | 240 | 30 | 720 |
| `kimi-k3` | Moonshot | Standard | 360 | 36 | 1,800 |

GPT Astra/Sol and Claude Opus/Fable support High and XHigh at the same per-token rates. Charges follow actual token usage. Other adapter routes may have different final prices. Credit receipts report the final charge for a completed request. See the [public pricing reference](https://docs.samsar.one/pricing) for the shared assistant and external-chat rate tables.


<a id="document-083d9b8cf53128bd3e078c582bc738f5"></a>
## Assistant Billing and Retries > Paid Tools and Pending Requests

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/assistant-billing.md

Image generation, web/file search, hosted code execution, and similar paid tools may incur separate charges. Requests using these tools can remain pending until billing is confirmed. Keep the original request key while checking completion.

Public API billing is described in the [Assistant API](https://docs.samsar.one/assistant-api) and [external assistant API](https://docs.samsar.one/external-requests#external-assistant-and-chat-completions). Credit receipts appear in `x-credits-charged` / `x-credits-remaining`; completed queued responses also include `creditsCharged` / `remainingCredits`.


<a id="document-9bd5ecd37a9ad16a7f3e4b62a4bbeeca"></a>
## Assistant Billing and Retries > Regression Checks

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/assistant-billing.md

From the monorepo root with workspace dependencies installed:

```bash
npm run test:assistant-billing --workspace services/processor
npm test --workspace services/assistant-query-processor
npm run test:credits-security --workspace services/processor
```

The suites cover final token prices, cached tokens, reasoning usage, free responses, concurrent requests, idempotent replay, failure recovery, external-user balances, customer budgets, pending billing confirmation, and unchanged production agent stage pricing. SDK request-option and credit-header checks live in the separate `samsar-js` repository (`npm test`).


<a id="document-ecd21e1e2f57ad9051ec544ca4f6d92a"></a>
## Assistant Billing and Retries > Retries and Settlement

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/assistant-billing.md

Save one request key for each logical submission and reuse it if the response is lost:

```js
const payload = {
  model: 'gpt-6-astra',
  messages: [{ role: 'user', content: 'Write a launch caption.' }],
};
const options = { idempotencyKey: 'launch-caption-001' };
const result = await samsar.createV2ExternalChatCompletion(payload, options);
```

The SDK sends `Idempotency-Key`. Queued external submissions also accept `client_request_id`, which can be used for status lookup. If both a client request ID and header key are supplied, the client request ID identifies the request. Keys are scoped to the authenticated account and request scope; a session assistant also scopes the key to its session and external identity. Use a non-empty string of at most 512 characters.

- The same key and payload return the completed response and original charge. Reusing the key with a changed payload returns `409`.
- A replay's `x-credits-charged` header reports the original debit. It does not represent another debit. Polling does not create another inference charge.
- Requests without a stable key are separate submissions, even when their text is identical.
- Requests awaiting billing confirmation or completion after a timeout can remain pending. Continue checking the existing request using the same key.

Default public queue-status retention is 24 hours. Requests still awaiting completion can remain pending beyond that period.


<a id="document-b31cd4bb1de11536f6353e5cfbfa21eb"></a>
## Assistant Billing and Retries > Scope

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/assistant-billing.md

| Request | Billing |
| --- | --- |
| Session assistant completion: `/v1/assistant/completion` and `/v2/assistant/completion` | Published token prices for the selected route. |
| External-user session assistant: `/v1/external_users/assistant/completion` | Same token prices, using the billing account for that identity. |
| Public `/v2/external/chat`, `/v2/external/chat/completions`, `/v2/external/assistant`, and `/v2/external/assistant/completions` | Same token prices for JSON, streaming, and queued requests. |
| Hosted Studio queued assistant worker | Same published token prices. |
| Standalone Studio queued assistant worker | Existing local-credit waiver; native providers or a hosted Samsar adapter can still bill their own accounts. |
| Production agent pipeline inference | Existing flat stage pricing, regardless of adapter. |

Image/video/audio routes, narrative generation, image titles, publication metadata, and other utility operations retain their own published rates.


<a id="document-0587c8262a9ed8f8d28976c9e64c0d11"></a>
## Assistant Billing and Retries > Streaming and Conversation Reset

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/assistant-billing.md

The public external chat/assistant completion routes accept `stream: true` when polling mode is off. They emit named SSE events: `request`, cumulative-text `snapshot`, `completed`, and `error`. The `completed` event carries the response and settled credit receipt. Reconnect with the same request key; a dropped connection does not cancel provider work. The synchronous `/v1/assistant/completion` session API remains a separate JSON contract. See the [streaming API contract](https://docs.samsar.one/external-requests#streaming-completion).

The Studio popup submits queued work through `/assistants/submit_assistant_query` and receives snapshots from `/assistants/assistant_query_stream`; `/assistants/assistant_query_status` remains available for polling. Clearing the conversation removes its messages, invalidates pending replies, and prevents stale workers from repopulating the cleared history. Project media remains intact. Usage already incurred can still settle, and accounting records are retained; clearing chat is not a refund.


<a id="document-7a2c6c4789295333a4571055508ec70f"></a>
## Audio and performance

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/audio-and-performance.md

Start with **[hosted Samsar.js](https://docs.samsar.one/external-requests#samsar-js)** to generate narration, music and sound, or to match a visible speaker to recorded dialogue. Then use the [model matrix](model-matrix.md) to explore supported standalone adapters.


<a id="document-992a76e73867dcef0d4b8a5cce83df58"></a>
## Audio and performance > Billing and delivery

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/audio-and-performance.md

Video sound-effect layers and lip sync use the [final video model-call pricing](video-model-billing.md#fal-backed-lip-sync-pricing), charged on completion for the selected adapter and configuration. Audio-only sound effects retain their separate [audio endpoint prices](https://docs.samsar.one/external-requests#audio). Production agent workflows keep their fixed stage prices. Use [hosted pricing](https://docs.samsar.one/pricing) and response credit headers for other managed requests. Direct provider adapters bill through their configured provider account. Persist request IDs, poll the matching audio or video status endpoint, and store the completed output URL after terminal success.


<a id="document-ec3fb277228fe0b7a53675edb25674cf"></a>
## Audio and performance > Choose the operation

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/audio-and-performance.md

| I need… | Hosted route | Model choices | Reference |
| --- | --- | --- | --- |
| Narration from text | `POST /v2/external/audio/text_to_speech` | `OPENAI`, `GOOGLE`, `ELEVENLABS`, `PLAYAI` in the hosted audio contract | [Speech matrix](model-matrix.md#speech) · [Audio docs](https://docs.samsar.one/external-requests#audio) |
| A backing track | `POST /v2/external/audio/text_to_music` | `LYRIA3`, `ELEVENLABS_MUSIC` | [Music matrix](model-matrix.md#music) · [Audio docs](https://docs.samsar.one/external-requests#audio) |
| An audio-only effect | `POST /v2/external/audio/text_to_sound_effect` | `SDAUDIO` and configured aliases | [Audio docs](https://docs.samsar.one/external-requests#audio) |
| Sound matched to a video | `POST /v2/external/video/sound_effect` | `MMAUDIOV2`, `MIRELOAI` | [Sound matrix](model-matrix.md#sound) · [Video docs](https://docs.samsar.one/external-requests#video) |
| Lip motion matched to dialogue | `POST /v2/external/video/lip_sync` | `SYNCLIPSYNC`, `LATENTSYNC`, `KLINGLIPSYNC`, `HUMMINGBIRDLIPSYNC`, `CREATIFYLIPSYNC` | [Lip-sync matrix](model-matrix.md#lip-sync) · [Video docs](https://docs.samsar.one/external-requests#video) |
| Transcript alignment | `POST /v2/external/audio/transcript_align` | Managed OpenAI `whisper-1` | [Transcription matrix](model-matrix.md#transcription) · [Audio docs](https://docs.samsar.one/external-requests#audio) |


<a id="document-57999fa3eb1f13df811b5c5bbb0470ab"></a>
## Audio and performance > Expand to standalone adapters

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/audio-and-performance.md

| Capability | Start with | Supported local alternatives / constraints |
| --- | --- | --- |
| OpenAI speech | Samsar.js | Native OpenAI; conditional exact GenBlaze mapping where validated. |
| Google speech | Samsar.js | Native Google Cloud. |
| ElevenLabs speech | Hosted Samsar.js | Setup advertises fal for this speech model. A direct ElevenLabs music key does not imply setup speech availability. |
| Lyria 3 | Samsar.js | Google Cloud or fal; validated music credentials affect runtime ordering. |
| ElevenLabs Music | Samsar.js | ElevenLabs or fal. |
| Lip sync and video sound | Samsar.js | fal for the model-specific routes in the matrix. |
| Custom music | Configured native endpoint | Register a compatible `CUSTOM_TEXT_TO_MUSIC` endpoint in standalone. |

**Studio catalog entries** such as AudioCraft and Cassette AI are identified separately in the matrix; catalog presence alone does not establish a working hosted or standalone route. For deployment configuration, use [Providers and Models](providers-and-models.md).


<a id="document-1af9cecd5f8f444e2b551c83cf2e5474"></a>
## Audio and performance > Generate with Samsar.js

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/audio-and-performance.md

```js
import SamsarClient from 'samsar-js';

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const music = await samsar.createExternalTextToMusicAudio({
  prompt: 'Warm acoustic backing music for a peaceful travel film.',
  model: 'LYRIA3',
  duration: 30,
});
console.log(music.data.request_id);
```

Save the returned request ID and follow the [audio status contract](https://docs.samsar.one/external-requests#audio). `getExternalAudioStatus(requestId)` polls audio work; video operations use `getExternalVideoStatus(requestId)`. A successful submission does not mean generation has completed.

Match a speaker to an existing voice track

```js
const performance = await samsar.createExternalLipSyncVideo({
  video_url: 'https://example.com/presenter.mp4',
  audio_url: 'https://example.com/dialogue.wav',
  lip_sync_model: 'SYNCLIPSYNC',
  duration: 8,
});
console.log(performance.data.request_id);
```

Replace example URLs with public media you control. See the [video operation contract](https://docs.samsar.one/external-requests#video) for required inputs, supported request shape and status handling.


<a id="document-90168c114d1bbf04c44b34f4e9dac141"></a>
## Audio and performance > Use audio inside a video workflow

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/audio-and-performance.md

Express video combines several independent stages. Set `tts_model` to `OPENAI`, `GOOGLE` or `ELEVENLABS`, and `backingtrack_model` to `LYRIA3` or `ELEVENLABS_MUSIC`. Speaker choices belong to the selected speech provider. See the [Video API](https://docs.samsar.one/video) for voice and optional stage settings.

`OPENAI_TTS` and `GOOGLE_TTS` are setup model identifiers. They are not the values for Express `tts_model`. Audio-only sound generation, video-conditioned sound, lip sync and transcript alignment are different operations with different payloads.


<a id="document-8f33aaa80aa47c21c3c77a1a722a5f43"></a>
## Features

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

- **One-shot Studio text-to-video up to 3 minutes** for documentary, infotainment, ed-tech, film summary, custom themes, and original ideas.
- **One-shot image-list-to-video** that turns product images into polished ad videos with optional narrator avatar, outro, and CTA.
- **One-click scene re-rolls after render** to fix small imperfections without rebuilding the full project.
- **Full Studio workspace** for detailed, granular post-processing.
- **Sandboxed local logging**, with logs and traces kept on your machine.
- **Multi-provider model routing** so each operation can use the best available provider and model.
- **Built-in search and recommendations** for creating a generative video library and Studio knowledge base.


<a id="document-ceff7897628c002111fc001956197a10"></a>
## Features > API

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

Use **samsar-js** against `https://api.samsar.one/v1` for hosted workflows. The routes below are also served by the standalone processor at `http://localhost:3002`. To target it with the SDK, set `baseUrl: 'http://localhost:3002/v1'` and use credentials accepted by that processor. Auth accepts a Samsar API key, auth token, or app key where supported by the route. See the linked [API reference](https://docs.samsar.one/) for each contract.

The Studio one-shot flow exposes durations up to 3 minutes; the text-to-video API accepts requests from 10 to 240 seconds.

| Workflow | Main endpoints | Notes |
| --- | --- | --- |
| Health | `GET /v1/chat/health`, `GET /v1/image/health`, `GET /v1/video/health`, `GET /v2/health` | Per-route health checks for local verification. |
| Supported video models | `GET /v1/video/supported_models` | Returns text-to-video and image-list-to-video model lists filtered by deployment availability. |
| Text enhance | `POST /v1/chat/enhance` | Enhances copy from `message`, optional `metadata`, `language`, and `maxwords`. |
| Search indexing | `POST /v1/chat/create_embedding`, `POST /v1/chat/create_embedding_from_url`, `POST /v1/chat/generate_embeddings_from_plain_text` | Creates reusable embedding templates from records, URLs, or plain text. |
| Search query | `POST /v1/chat/search_against_embeddings` | Searches a template with `search_term`, filters, and optional reranking. |
| Recommendations | `POST /v1/chat/similar_to_embeddings` | Returns similar records from a template using text or structured search JSON. |
| Assistant workflows | `POST /v1/assistant/*`, `POST /v2/assistant/*` aliases | Runs assistant queries through the processor and configured inference provider. |
| Managed chat/assistant completions | `POST /v2/external/chat/completions`, `POST /v2/external/assistant/completions` | OpenAI-compatible messages; synchronous or queued polling; published input, output, and cached-input token rates. |
| Image edit/generation | `POST /v1/image/text_to_image`, `POST /v1/image/enhance`, `POST /v1/image/remove_branding`, `POST /v1/image/add_image_set` | Queues image sessions and returns request IDs for polling. |
| Image status | `GET /v1/image/status?request_id=...`, `GET /v1/image/list` | Polls and lists image API sessions. |
| Text-to-video | `POST /v1/video/text_to_video`, `POST /v2/text_to_video` | Requires prompt, image model, video model, and duration from 10 to 240 seconds. |
| Image-list-to-video | `POST /v1/video/image_list_to_video`, `POST /v2/image_list_to_video` | Uses image URLs, prompt/metadata, selected models, aspect ratio, and optional CTA/outro/footer/narrator settings. |
| Video status | `GET /v2/status`, `GET /v2/status_detailed`, `GET /v1/external_users/status` | Status endpoints support request IDs/session IDs; terminal provider/model failures include the exact stored error, with failed layer details in `status_detailed`. |


<a id="document-237bf73b5aae4f6f133621c82750f256"></a>
## Features > API > Assistant billing

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

Assistant completions and public chat/assistant endpoints called through **samsar-js** use the [final input, output, and cached-input token prices](pages/assistant-billing.md#final-token-prices), listed in credits per one million tokens for each model and adapter route. Production agent pipeline inference retains its flat stage pricing.

For retries, pass `{ idempotencyKey: 'stable-request-id' }` in SDK request options or reuse `client_request_id`. The same key and payload reuse the response and original charge; changed payloads return `409`. Requests awaiting billing confirmation or completion after a timeout can remain pending; keep the same key while checking completion.

See [Assistant billing and retries](pages/assistant-billing.md) for endpoint scope, standalone behavior, tool limitations, and regression commands. Other media, narrative, and utility routes retain their route-specific pricing.


<a id="document-8fd78cde3088bcb3449bde5884d2f478"></a>
## Features > API > Image billing

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

Image generation, edits, enhancements, and image sets settle on completion for the selected model, adapter, and configuration. Poll status for `creditsCharged`, `remainingCredits`, and `billingStatus`. Production agent pipelines retain fixed stage prices; standalone calls through Samsar.js receive one hosted charge.

The detailed tables live in [Image billing and retries](pages/image-billing.md) and the [public image price reference](https://docs.samsar.one/pricing#image-models).


<a id="document-e2e55fdb3e5825f9afde5d697c2d5729"></a>
## Features > API > Video model billing

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

Studio clips, scene rerolls, lip sync, and video sound effects settle each completed model call. Full video workflows use their own fixed rates; for Seedance 2.5, Agent/Vidgenie uses 60 credits/sec and the standard Express rate class uses 50 credits/sec.

Kling 4 uses `KLINGIMGTOVID4` or `KLINGTXTTOVID4`: 720p, no native audio, and 5–30-second clips in five-second steps. Its direct model-call rate is 18.84 credits/sec; the fixed workflow rate remains 36 credits/sec. Older 3 Pro/Turbo request keys normalize to Kling 4 for new submissions; accepted jobs retain their saved endpoint.

See [Video model billing and retries](pages/video-model-billing.md) for configuration-specific prices, duration units, receipts, and recovery, or [compare all workflow and model-call prices](https://docs.samsar.one/pricing).


<a id="document-d69e60895e95e1988e2586ed242b217e"></a>
## Features > Adapters, models, and storage

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

Start with the **Samsar.js managed adapter** for supported hosted workflows, then add compatible native or provider adapters to a standalone installation. Native inference and custom model endpoints can take precedence for their own models. Documentation order does not change the runtime’s configured routing.


<a id="document-e77e06757d1a1a0727f64eaab9f142ea"></a>
## Features > Adapters, models, and storage > Minimal adapter setup

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

For hosted use, create a [Samsar API key](https://app.samsar.one/account/apiKeys) and initialize `samsar-js`. For standalone use, open **Providers** in `./setup.sh`, configure Samsar and any required native/provider keys, and validate them. The wizard writes secrets and computes deployment availability. **Settings → Model Adapters** controls supported per-model preference order.

| Path / adapter | What you supply | What to expect |
| --- | --- | --- |
| **Samsar.js** | `SAMSAR_API_KEY` | Managed routes for supported models using Samsar credits. [API reference](https://docs.samsar.one/external-requests). |
| Native inference | OpenAI, Anthropic, Google, Kimi or Alibaba credentials for the selected model | Native-first paths where supported. [Provider setup](pages/providers-and-models.md#provider-matrix). |
| Media adapters | Supported Google, OpenAI, Runway, fal, Alibaba or ElevenLabs credentials | Only the models and operations mapped to that adapter. [Per-model matrix](pages/model-matrix.md). |
| GMICloud through GenBlaze | `GMI_API_KEY` and validated model mappings | Credential-specific inference/media routes through the local gateway. [Gateway details](services/genblaze-gateway/README.md). |
| Custom model endpoint | Compatible endpoint and authorization | Your own registered adapter, including optional [Vast.ai FLUX.2](utils/vast-flux2/README.md). |

`npm run config:render` writes backend environment files and `runtime/config/available-models.json`. Studio and the Express API filter models using the current deployment configuration. Keep credentials in server-side secrets.

See [Providers and Models](pages/providers-and-models.md) for routing and exceptions. Seedance 2.5 uses 5-, 10- or 15-second 720p scene renders; hosted production uses GMICloud internally, while standalone follows the selected supported adapter.


<a id="document-808fd40ab42c02da6a6330327d3c0803"></a>
## Features > Adapters, models, and storage > Model adapters

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

[Samsar.js](https://www.npmjs.com/package/samsar-js) is the common client and hosted service entry point. Supported deployment options include [OpenAI](https://platform.openai.com/docs/overview), [Anthropic](https://platform.claude.com/docs/en/api/overview), [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs), [Kimi](https://platform.kimi.ai/docs/overview), [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/), [GMICloud](https://docs.gmicloud.ai/) through [GenBlaze](https://github.com/backblaze-labs/genblaze), [fal](https://fal.ai/docs/documentation), [OpenRouter](https://openrouter.ai/docs/quickstart), [ElevenLabs](https://elevenlabs.io/docs/overview/intro), and [Runway](https://docs.dev.runwayml.com/).


<a id="document-87316fab814455bb7f916a2f3b8a5384"></a>
## Features > Adapters, models, and storage > Storage adapters

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

Choose one option under **Mail & Data → Media storage** in the setup wizard.

| Adapter | Wizard option | Configuration |
| --- | --- | --- |
| MinIO | **Local MinIO** | No cloud credentials. Starts the bundled S3-compatible service with bucket `samsar-resources`; media remains local and is served through the Processor API. |
| S3-compatible / AWS S3 | **External S3 / CloudFront** | Enter bucket, region, access key, secret key, and an HTTPS public CDN base URL. Add an endpoint for non-AWS S3, enable path-style URLs when required, and optionally add CloudFront signing keys. |
| Backblaze B2 Cloud Storage | **Backblaze B2** | Create a public bucket, then enter bucket name, Application Key ID, Application Key value, and its endpoint such as `s3.us-east-005.backblazeb2.com`. The wizard derives the public bucket URL and verifies region, bucket access, and `writeFiles`. Master keys upload through the native B2 API; standard application keys use the S3-compatible API. |

External S3 and B2 publish media for remote model providers. MinIO keeps media local and starts the local media tunnel automatically when a configured provider needs a public URL.


<a id="document-4cf4c265187e0df7ecb7663032394126"></a>
## Features > Adapters, models, and storage > Supported models by capability

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

The [complete model matrix](pages/model-matrix.md) lists **all 46 model keys in the standalone setup registry**, plus the additional Studio catalog, custom endpoints and managed service models. Each row includes the request key, hosted path, supported adapters, workflow scope and usage notes.

| Modality | Models in the deployment registry | Explore and build |
| --- | --- | --- |
| Inference & vision | GPT 6 Astra / 6.1 Sol, Claude Opus 5.5 / Fable 5.1, Gemini 4 Argon, Kimi K3, Qwen 3.8 Max | [Matrix](pages/model-matrix.md#inference) · [Hosted chat](https://docs.samsar.one/external-requests#chat) |
| Image generation | GPTImage 2.6, Seedream 5 Pro, Nano Banana 2 / Pro, Qwen Image 3.0 Pro, Wan 2.7 Pro | [Matrix](pages/model-matrix.md#image) · [Image API](https://docs.samsar.one/image-api) |
| Image editing | GPTImage 2.6 Edit, Nano Banana 2 / Pro Edit, BRIA Eraser / GenFill | [Matrix](pages/model-matrix.md#image-edit) · [Edit API](https://docs.samsar.one/v2#v2-image-edit-routes) |
| Video generation | Runway; Veo 3.1 text / fast / I2V / first-last-frame; Cosmos 3; Seedance 1.5 / 2.0 / 2.5; Kling 4; legacy 1.6 / 2.1 variants; Hailuo; Happy Horse 1.1 | [Every video key](pages/model-matrix.md#video) · [Video API](https://docs.samsar.one/video) |
| Speech | OpenAI TTS, Google TTS, ElevenLabs | [Matrix and request values](pages/model-matrix.md#speech) · [Audio API](https://docs.samsar.one/external-requests#audio) |
| Music | Lyria 3, ElevenLabs Music | [Matrix](pages/model-matrix.md#music) · [Audio API](https://docs.samsar.one/external-requests#audio) |
| Lip sync | Sync, LatentSync, Kling, Hummingbird, Creatify | [Matrix](pages/model-matrix.md#lip-sync) · [Video operations](https://docs.samsar.one/external-requests#video) |
| Sound effects | MMAudio V2, Mirelo AI; hosted audio also exposes SDAUDIO | [Matrix](pages/model-matrix.md#sound) · [Audio and performance](pages/audio-and-performance.md) |
| Embeddings & search | Managed OpenAI embeddings (`text-embedding-3-large`) | [Matrix](pages/model-matrix.md#embeddings) · [Search](pages/search.md) |
| Transcript alignment | Managed Whisper (`whisper-1`) | [Matrix](pages/model-matrix.md#transcription) · [Audio API](https://docs.samsar.one/external-requests#audio) |

Understand model keys, workflow support and native exceptions

- **Model keys:** `GPTIMAGE2.5` and `GPTIMAGE2.5EDIT` retain their spelling for compatibility and now select GPTImage 2.6 Sunburst (High); retired `GPTIMAGE2` requests return an Invalid model validation error; `SEEDREAM` maps to Seedream 5 Pro; `HAPPYHORSEI2V` maps to Happy Horse 1.1 I2V. Use Samsar keys rather than an upstream provider ID.
- **GPT Image providers:** OpenAI generation and editing use `gpt-image-2.6-sunburst`; fal generation uses `openai/gpt-image-2.6/sunburst/text-to-image`. Quality remains `high`, with the same image dimensions and Studio prices. Previously submitted jobs retain their original provider model or endpoint.
- **GPT and Claude choices:** use `gpt-6-astra`, `gpt-6.1-sol`, `claude-opus-5.5`, or `claude-fable-5.1` with `effort: "high"` or `effort: "xhigh"` for inference and vision. Defaults remain Astra and High. Native and OpenRouter credentials enable both models in their family. Older `gpt-5.6-sol` aliases normalize to Astra. `KIMIK3` is the setup key; use `kimi-k3` in inference requests.
- **Workflow scope:** the complete Studio catalog is larger than the Express and branching allowlists. A model listed for image generation is not automatically selectable for an Express scene.
- **Native-only model:** `QWENIMAGE3PRO` needs Alibaba Cloud standard pay-as-you-go credentials. It is not enabled by a Samsar key or Alibaba Token Plan.
- **Credential-scoped model routes:** GenBlaze enables only exact validated GMICloud mappings. Legacy GPT Image 2 mappings do not satisfy the GPTImage 2.6 contract.
- **Speech values:** Express uses `tts_model: 'OPENAI'`, `'GOOGLE'` or `'ELEVENLABS'`, not the setup labels `OPENAI_TTS` and `GOOGLE_TTS`.


<a id="document-7fa37fb2bb77eeb339739d59d2525110"></a>
## Features > Deployment and operations

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/README.md

Manual Docker setup

Use this path only when you do not want the browser setup wizard to write runtime config for you.

Create a local runtime config:

```bash
mkdir -p runtime/config runtime/secrets
cp -n samsar.config.example.json runtime/config/samsar.config.json
```

Edit `runtime/config/samsar.config.json` for provider enablement, non-secret provider settings, storage, database, and public URLs. Provider credentials can be kept in `runtime/secrets/provider.credentials.json`. The checked-in example is safe for local Docker defaults: local MongoDB, local MinIO-compatible storage, local media gateway, and no external provider enabled.

Render env files:

```bash
npm run config:render
```

Install Docker-visible fonts and prepare the optional local logger stack:

```bash
npm run docker:setup-assets
```

Start the complete local Docker stack:

```bash
npm run docker:up
```

Docker Compose profiles, volumes, and maintenance

Validate the rendered Compose configuration:

```bash
npm run docker:config
```

`npm run docker:up` first starts the setup wizard and waits for port `8089` to
respond. With `runtime/config/samsar.config.json` present, it renders
`runtime/secrets/root.env`, durable infrastructure credential env files, and
`runtime/config/available-models.json`, then initializes authenticated MongoDB and
starts the configured profiles. Without a saved config, it leaves configuration
and deployment to the wizard. The setup wizard adds the reverse-proxy profile only
when nginx access is enabled. A wizard startup failure stops deployment before
runtime configuration or application containers are changed.

| Profile | Services |
| --- | --- |
| `core` | `client`, `processor` |
| `workers` | `generator`, `audio-generator`, `frames-processor`, `video-generator`, `ai-video-layer-generator`, `express-video-listener`, `assistant-query-processor`, `task-processor` |
| `local-mongo` | `mongo` |
| `minio` | `minio` |
| `genblaze` | `genblaze` (enabled only with a validated GMICloud provider) |
| `local-media` | `media-gateway`, `media-tunnel-controller` |
| `logger` | `loki`, `promtail`, `grafana` |
| `reverse-proxy` | Optional `reverse-proxy` nginx service when enabled by the setup wizard. |

Run `npm run docker:setup-assets` whenever fonts or logger config need to be refreshed. It installs subtitle/render fonts into `runtime/fonts`, copies them into running Samsar service containers, and recreates Promtail/Grafana only when `services.logger` is enabled.

Persistent Docker state is stored in `mongo-data`, `minio-data`, `media-assets`, `media-assets-v2`, `persistent-data`, `loki-data`, `promtail-data`, and `grafana-data`.

Inspect logs:

```bash
docker compose -f deploy/compose/docker-compose.yml logs -f processor client
```

Rebuild and replace only the frontend container:

```bash
docker compose -f deploy/compose/docker-compose.yml --profile core build client
docker compose -f deploy/compose/docker-compose.yml --profile core up -d --force-recreate --no-deps client
```

When making changes during an active generation session, prefer restarting only the affected client or API container.

> **Active jobs:** Avoid restarting generation workers while a video, audio, or sound-effect job is active unless you have confirmed the worker is stuck or the job can safely resume.

Local media URLs and remote-provider access

In local Docker, completed render URLs are expected to look like:

```text
http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

That browser URL is served by the configured processor API from the mounted media volume. It is not an S3 or CloudFront URL unless external media publishing is enabled in runtime config.

When a remote provider must fetch local-only media, the `local-media` profile starts a Compose-managed Cloudflared controller. It starts a quick tunnel when runtime config enables a remote media consumer, validates the exact media-gateway health marker, atomically publishes `localMediaTunnel.publicUrl`, and replaces the tunnel when health checks fail or a worker writes the shared refresh marker. It does not mount the Docker socket or depend on the setup-wizard process.

For a manual runtime, start or recreate only the local-media services:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml \
  --profile local-media up -d --build \
  media-gateway media-tunnel-controller
```

Inspect its lifecycle and current URL:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml \
  --profile local-media logs -f media-tunnel-controller
```

Provider workers reload and validate the published URL before each public adapter request. Browser previews continue to use the configured processor or reverse-proxy URL.

The legacy `scripts/start-local-media-tunnel.sh` command remains a compatibility wrapper that starts and waits for the same Compose services instead of creating a second tunnel container.

Runtime configuration and generated files

The main config file is `runtime/config/samsar.config.json`. Its local Docker defaults are:

- `database.provider`: `local-mongo`
- `storage.mode`: `local-minio`
- `storage.provider`: `s3-compatible`
- `storage.backend`: `minio`
- `storage.staticCdnUrl`: `http://localhost:3002/`
- `storage.externalMediaPublishEnabled`: `false`
- `publicUrls.clientApp`: `http://localhost:3000`
- `publicUrls.processorApi`: `http://localhost:3002`
- `publicUrls.media`: `http://localhost:3002`
- `reverseProxy.enabled`: `false`

Enable only the providers you intend to use, then rerender:

```bash
npm run config:render
```

For a manual Alibaba Cloud setup, enable the provider in `runtime/config/samsar.config.json` and save this as `runtime/secrets/provider.credentials.json`:

```json
{
  "version": 1,
  "alibabaCloud": {
    "apiKey": "<alibaba-model-studio-api-key>",
    "apiHost": "https://workspace-id.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
  }
}
```

Protect it with `chmod 600 runtime/secrets/provider.credentials.json` before rendering. The setup wizard performs these steps automatically after validating the credentials.

Generated files:

- `runtime/secrets/root.env`: env consumed by Docker services.
- `runtime/secrets/application.env`: generated application signing and custom-adapter encryption secrets.
- `runtime/secrets/mongo.env`: generated local MongoDB root and application credentials. Services use the application account through the authenticated `MONGO_URL` in `root.env`.
- `runtime/secrets/minio.env`: generated local MinIO administrator credentials.
- `runtime/secrets/grafana.env`: generated Grafana administrator credentials.
- `runtime/secrets/provider.credentials.json`: setup-wizard-managed provider keys and validated endpoints. Keep it private and mode `0600`.
- `runtime/config/available-models.json`: model/action availability derived from enabled providers.
- `runtime/config/model-adapter-preferences.json`: standalone-admin adapter order overrides saved from **Settings → Model Adapters**. Config rendering preserves this file.

See [Architecture](pages/architecture.md) for storage and deployment defaults and [Providers and Models](pages/providers-and-models.md) for credential, availability, and fallback behavior.


<a id="document-dbbec168912608ad37a1e412943cb53b"></a>
## Features > Deployment and operations > External access

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/README.md

> [!WARNING]
> Public reverse-proxy and domain access are disabled by default, but Docker publishes the Studio and processor ports on the host. Use host firewall rules or localhost-only Docker port bindings when the stack must not be reachable from other networks.

The setup wizard can optionally enable nginx for a public domain/subdomain, public IP, or private IP. For public domain access, add A records for the Studio and processor domains pointing to the machine IP in your DNS provider. For public/private IP access, the wizard can detect IP candidates and uses one machine IP: Studio at `http://<ip>` and the processor/media base at `http://<ip>/api`. For production deployment, non-SSL access needs port `80`; Let's Encrypt SSL setup uses ports `80` and `443`, then closes port `80` if Samsar opened it. The wizard can try to manage these host firewall rules automatically on supported Linux hosts.

Set a strong setup/admin password first and restrict access with HTTPS, firewall rules, and authentication.

For custom enterprise deployments behind a VPS, private network, or managed ingress, contact [hello@samsar.one](mailto:hello@samsar.one).


<a id="document-a1f146535eb92d85b261fe08936d3f90"></a>
## Features > Development

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

Run the fast, dependency-free test suite:

```bash
npm test
```

Validate the generated runtime files and full Docker Compose deployment configuration:

```bash
npm run test:deployment
```

GitHub Actions runs both checks for pull requests into `main` and pushes to `main`.

> [!CAUTION]
> Do not commit runtime credentials, generated assets, local uploads, dependency folders, or build output.


<a id="document-ddd21a4578cb896df71433e262eeb9d7"></a>
## Features > Documentation

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

Follow a workflow from the hosted Samsar.js API into its local deployment details. Each guide retains its endpoint, input, processing and verification sections.

| Workflow / guide | Hosted API reference | Repository guide |
| --- | --- | --- |
| Model matrix | [API overview](https://docs.samsar.one/) · [Models & pricing](https://docs.samsar.one/pricing) | [Every modality, model key and compatible adapter](pages/model-matrix.md) |
| Providers and Models | [Samsar managed provider API](https://docs.samsar.one/external-requests) | [Credentials, native options and routing](pages/providers-and-models.md) |
| Text to Video | [Video API](https://docs.samsar.one/video#post-videotext_to_video) | [Models, pipeline and status](pages/text-to-video.md) |
| Image List to Video | [Image-list API](https://docs.samsar.one/video#post-videoimage_list_to_video) | [Product videos, CTA and narrator settings](pages/image-list-to-video.md) |
| Image Edit | [Image API](https://docs.samsar.one/image-api) · [V2 edits](https://docs.samsar.one/v2#v2-image-edit-routes) | [Generation, enhancement and edits](pages/image-edit.md) |
| Speech, music, sound and lip sync | [Audio](https://docs.samsar.one/external-requests#audio) · [Video operations](https://docs.samsar.one/external-requests#video) | [Audio and performance guide](pages/audio-and-performance.md) |
| Inference and assistants | [Chat](https://docs.samsar.one/chat-api) · [Assistant](https://docs.samsar.one/assistant-api) | [Inference matrix](pages/model-matrix.md#inference) · [Billing and retries](pages/assistant-billing.md) |
| Narrative and branching | [Narrative API](https://docs.samsar.one/narrative) | [Workflow allowlists](pages/providers-and-models.md#model-groups-used-by-video-apis) |
| Search | [Index and search](https://docs.samsar.one/chat-api#post-chatcreate_embedding) | [Templates, filters and indexing](pages/search.md) |
| Recommendations | [Similarity API](https://docs.samsar.one/chat-api#post-chatsimilar_to_embedding) | [Related content and product matching](pages/recommendations.md) |
| Text Enhance | [Enhance API](https://docs.samsar.one/chat-api#post-chatenhance) | [Inputs, billing and inference](pages/text-enhance.md) |
| Accounts and delivery | [External users](https://docs.samsar.one/external-users) · [Credits](https://docs.samsar.one/credits) · [Publications](https://docs.samsar.one/publications) | [Architecture](pages/architecture.md) |
| Setup and operations | [V2 API](https://docs.samsar.one/v2) | [Setup wizard](pages/setup-wizard.md) · [Architecture](pages/architecture.md) |


<a id="document-4e1eead4f141cbbe18dea97aa2a4e6d0"></a>
## Features > Platform > Repository layout

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/README.md

| Area | Directory | Purpose |
| --- | --- | --- |
| Studio app | `apps/samsar-client` | Samsar Studio and VidGenie frontend. Runs on port `3000` in Docker. |
| Setup wizard | `apps/setup-wizard` | Browser setup flow for providers, services, data, mail, and admin configuration. Starts on port `8089` before application builds through `deploy`, `docker:up`, and `docker:restart`. |
| Processor API | `services/processor` | Public API, Studio API, auth, billing, session orchestration, search/recommendation APIs, and status endpoints. Runs on port `3002`. |
| Generation workers | `services/generator`, `services/ai-video-layer-generator`, `services/video-generator`, `services/audio-generator`, `services/frames-processor` | Image generation/editing, AI video layers, final rendering, speech/music/sound effects, frame processing, and media processing. |
| Workflow workers | `services/express-video-listener`, `services/assistant-query-processor`, `services/task-processor` | Express video state machine, assistant queries, and scheduled/background tasks. |
| Provider gateway | `services/genblaze-gateway` | Local GenBlaze gateway for credential-scoped GMICloud inference and media models. |
| Runtime config | `runtime/config`, `runtime/secrets` | Generated deployment config, model availability, env files, and local secrets. Not committed. |
| Deployment | `deploy/compose` | Docker Compose stack and local deployment configuration. |
| Docs | `docs`, `pages` | Runtime notes, brand assets, and deeper Markdown documentation linked from this README. |

View the Docker deployment architecture


<a id="document-abc08545969d20ef5b5b4d676a3d0166"></a>
## Features > Quick start

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/README.md

Start with [hosted Studio](https://app.samsar.one) or the **[samsar-js client](https://www.npmjs.com/package/samsar-js)**. One Samsar API key connects your application to managed video, image, audio and inference workflows. Move into the setup wizard below when you want your own deployment and supported provider adapters.

| I want to… | Start here | Then explore |
| --- | --- | --- |
| Create in the browser | [Hosted Studio](https://app.samsar.one) | [Visual workflows](#visual-workflows) |
| Build with an API | [Hosted Samsar.js](https://docs.samsar.one/) | [Video](https://docs.samsar.one/video), [images](https://docs.samsar.one/image-api), [chat](https://docs.samsar.one/chat-api), [audio](https://docs.samsar.one/external-requests#audio) |
| Compare models and modalities | [Full model matrix](pages/model-matrix.md) | [Provider and adapter guide](pages/providers-and-models.md) |
| Run my own deployment | Setup steps below | Native inference, Samsar.js and compatible provider adapters |

First API request with hosted Samsar.js

```bash
npm install samsar-js
```

```js
import SamsarClient from 'samsar-js';

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const available = await samsar.getSupportedTextToVideoModels();
console.log(available.data);

const job = await samsar.createVideoFromText({
  prompt: 'A cinematic product launch in a sunlit gallery.',
  image_model: 'GPTIMAGE2.5',
  video_model: 'RUNWAYML',
  duration: 30,
  aspect_ratio: '16:9',
});
console.log(job.data.request_id); // Save this ID and poll for completion.
```

Get a key from [Samsar](https://app.samsar.one/account/apiKeys), keep it in your server environment, and follow the [status and delivery contract](https://docs.samsar.one/video#get-status). Hosted requests use Samsar credits; see [pricing](https://docs.samsar.one/pricing). No local Docker installation is needed for this path.

The following steps install a **standalone deployment**.


<a id="document-e74583bb9f10adc586c2c29118422f33"></a>
## Features > Quick start > 1. Prepare

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/README.md

- Git.

> [!NOTE]
> Node.js, npm, and Yarn are not host prerequisites for a standalone installation. The setup wizard and its JavaScript tooling run inside Docker.

If you cloned this repository directly, stay at the repository root and continue to step 2.

Using this repository as a deployable wrapper around sibling source projects?

This parent-workspace workflow additionally requires `rsync`, Node.js, and npm:

```bash
cd samsar
npm run sync
```

The sync script excludes common secret and generated paths when copying projects into this monorepo. Skip this workflow in a standalone clone.

After updating sibling source projects, sync all services, start the setup wizard,
and rebuild the configured local stack with:

```bash
npm run sync:restart
```

This finishes the sync, starts the setup wizard on `http://localhost:8089`, and
waits for it before building application images. With an existing runtime config,
all image builds finish before application containers are replaced; data volumes
are preserved and the command waits for the configured services. A fresh install
opens the wizard for configuration and deployment. `npm run docker:restart`
performs the same wizard-first rebuild without another source sync.

It also packages the Vast.ai FLUX.2 standalone utility under
`utils/vast-flux2`. From a synchronized workspace or standalone clone:

```bash
cd utils/vast-flux2
./provision-vast-flux2.sh --check
./provision-vast-flux2.sh --configure-samsar
```

For an already provisioned endpoint, register the latest securely saved
adapter with the running standalone Samsar processor:

```bash
cd utils/vast-flux2
./configure-samsar-custom-image-model.sh
```

The provisioner stores credentials outside the repository under
`~/.config/samsar/vast-flux2` with owner-only permissions. See
`utils/vast-flux2/README.md` for credential setup, URL output, instance
destruction, and advanced options.

How the launcher handles Docker on each platform

The direct setup launcher checks Docker before continuing:

| Platform | Bootstrap behavior |
| --- | --- |
| Linux | Requires Docker Engine 20.10.0+, Docker Compose 2.20.0+, and Buildx. Missing installations receive current packages; deficient existing installations are updated only through their existing installation channel without changing package families. |
| macOS | Requires Docker Desktop 4.84.0 or newer. Uses an existing compatible installation, or installs/updates it automatically when the Docker Desktop updater or Homebrew is available. |
| Windows | Requires Docker Desktop 4.84.0 or newer. `setup.ps1` detects per-user and all-users installations, uses the Docker Desktop updater or `winget` to install/update it, and runs the launcher through WSL 2 integration. |

Set `SAMSAR_SETUP_INSTALL_DOCKER=0` to disable automatic Docker installation and updates. An incompatible installation then produces a platform-specific manual update instruction instead of being changed.
On macOS without Homebrew, install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/).
On Windows without `winget`, install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) and enable WSL 2 integration.
On Linux, the launcher does not replace an existing distro, Snap, rootless, or Docker Desktop installation with a different package family. It updates through a recognized existing channel when that is safe and otherwise links the matching [Docker Engine installation guide](https://docs.docker.com/engine/install/). Docker's convenience installer is used only as a fresh-install fallback, never to upgrade an existing Engine.
Arch requires a full system package upgrade, so the launcher asks for explicit confirmation (or requires `--yes`) before running `pacman -Syu`. Inside WSL, the launcher uses Docker Desktop's Windows integration and never installs or starts a competing in-distribution Engine.
The Linux version numbers are functional compatibility floors, not a recommendation to remain on an old patch; keep Docker on a current, vendor-supported release.

> [!IMPORTANT]
> On macOS, use Docker Desktop 4.84.0 or newer. Earlier releases predate the [4.45.0 wake-from-sleep VM fix](https://docs.docker.com/desktop/release-notes/#4450) and the [4.79.0 VM-wake API 500 fix](https://docs.docker.com/desktop/release-notes/#4790). The launcher verifies the installed app version before starting the setup wizard. When automatic Docker installation is enabled, it attempts an in-place update; otherwise it stops with an upgrade instruction.
>
> Windows uses the same Docker Desktop minimum so launcher behavior stays consistent across Desktop platforms. Native Linux does not contain Docker Desktop's macOS VM/network path; its separate Engine and Compose floors are based on Samsar's runtime and compose-file features.


<a id="document-2b1a14e6a3195a3b67fe2de329373e9e"></a>
## Features > Quick start > 2. Launch the setup wizard

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/README.md

Linux, macOS, or WSL:

```bash
./setup.sh
```

Windows PowerShell:

```powershell
.\setup.ps1
```

Windows Command Prompt:

```bat
setup.cmd
```

`npm run setup-wizard` remains available as a developer convenience, but is not required for installation.

For a workspace with Node.js and npm, `npm run deploy` (also available as
`npm run docker:up`) starts the wizard first. With no saved runtime config, complete
configuration and deployment in that browser window. With a saved config, the
command continues into the application build after the wizard is ready. The
wizard stays available if an application build fails.

The launcher installs or starts Docker when supported, builds and starts the containerized setup wizard, waits for it to respond, and opens a one-time authenticated URL on `http://localhost:8089`. The wizard binds to loopback by default; use `scripts/setup-wizard-remote.sh` for remote hosts so access travels through an SSH tunnel. Set `SAMSAR_SETUP_OPEN_BROWSER=0` to skip browser auto-open.

Complete the browser flow to write deployment config, render runtime env and model availability, build and start the selected Docker Compose profiles, publish the local media gateway when required, verify the processor API and Studio client, and prepare local login.


<a id="document-6481e358b995e871ad96268c85432916"></a>
## Features > Quick start > 3. Open your local services

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/README.md

| Service | URL |
| --- | --- |
| Studio | `http://localhost:3000` |
| Processor API | `http://localhost:3002` |
| Local media through Processor API | `http://localhost:3002/assets_v2/...` |
| MinIO console (local storage mode) | `http://localhost:9001` (loopback; generated credentials in `runtime/secrets/minio.env`) |
| Grafana logs | `http://localhost:4000` (loopback; generated credentials in `runtime/secrets/grafana.env`) |

Stop the stack:

```bash
npm run docker:down
```

What the five setup wizard steps configure

| Step | What it configures | Runtime effect |
| --- | --- | --- |
| Providers | Inference routing, OpenAI, Google Cloud, Kimi K3, Alibaba Cloud, GMICloud through GenBlaze, OpenRouter, FAL, ElevenLabs, RunwayML, Samsar | Validates credentials and controls which models/actions appear in `runtime/config/available-models.json`. |
| Services | Processor, setup wizard, image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener, and logger | Determines which Docker service families are enabled for the local runtime. |
| Mail and Data | Local or remote MongoDB, local MinIO, external S3/CloudFront, Backblaze B2, SMTP/SES/disabled mail | Writes database, storage, CDN, media, and mail settings. |
| Domain | Optional nginx reverse proxy for a public domain/subdomain, public IP, or private IP, with optional IP detection, port opening, and Let's Encrypt SSL for validated domains | Enables public or intranet access URLs for Studio and the processor API. |
| Admin | Organization and initial admin/login setup | Prepares Docker setup login and local access details. |

Use manual runtime config when you want direct control over credentials, provider selection, storage URLs, database settings, or mail settings.

[Explore every setup step, validation, generated file, and lifecycle stage →](pages/setup-wizard.md)


<a id="document-75c760c39a628511645dec29f825be26"></a>
## Features > Troubleshooting

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

A local Docker page fails on first navigation

If a local Docker page fails only on first navigation with a dynamic import error, the browser is usually holding an old frontend build while the container serves a newer build. Refresh the tab. The Docker client server also returns a reload module for missing hashed JS chunks so stale tabs can recover automatically.

Local downloads open in a new tab

Confirm the processor API can serve the mounted asset:

```bash
curl -I http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

Remote generation providers cannot fetch local media

Open [Local media URLs and remote-provider access](#local-media), then inspect the Compose-managed tunnel lifecycle and current URL. Provider workers validate the exact asset and wait for a refreshed tunnel before dispatching.

Grafana runs on a remote Docker host

Set `GRAFANA_ROOT_URL` and optionally `GRAFANA_DOMAIN`, `GRAFANA_PORT`, or `LOKI_PORT` before starting Compose.

---

  Blog
  ·
  Enterprise deployments


<a id="document-2bdabaae194b0f4cebd14351971d0b8c"></a>
## Features > Visual workflows

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

The diagrams below show the primary generation and discovery pipelines. Open any workflow to explore it, then select the diagram for its detailed documentation.

Text to Video



Image List to Video



Search Embeddings



Recommendations


<a id="document-698754e3d8e6192c3efcebe88dee3c41"></a>
## Image Billing and Retries

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-billing.md

Studio image generation, edits, enhancements, external image endpoints, and reroll image requests are charged when each image-model call completes. See the [final image token and output prices](https://docs.samsar.one/pricing#image-models) for the listed model, adapter, and configuration.

Production agent pipelines retain their flat stage pricing. Standalone Docker does not debit local image credits. When its image adapter uses Samsar.js, each hosted image request is billed by the hosted image endpoint; the local worker does not add another debit.


<a id="document-b6a36cd297200cfe322e8959057bd229"></a>
## Image Billing and Retries > Completion receipts

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-billing.md

Image API submissions return zero credits charged and a pending billing status. Poll the image status endpoint for the final `creditsCharged`, `remainingCredits`, `x-credits-charged`, and `x-credits-remaining` values. Rerolls settle image, AI-video, lip-sync and video sound-effect model calls individually on completion; the quote does not prepay those calls.

Use one SDK `idempotencyKey` per logical image submission and reuse it after a lost response. The same key and payload reuse the job and its original charge. Changing the payload under that key returns `409`. Polling does not create another image call or debit.

Requests awaiting billing confirmation remain pending. Keep the original request key and continue polling.


<a id="document-cd6df3bdf66964b19ba04d3b53af3361"></a>
## Image Billing and Retries > Deployment Configuration

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/image-billing.md

Hosted direct Fal image completion uses the saved, checked-in model tariff and does not call Billing Events or a pricing endpoint. A model or option without a verified tariff stops before a new paid Fal submission under that billing policy. Existing saved results remain available for idempotent billing recovery.


<a id="document-21fd28711ad757ffd54b35267db68e22"></a>
## Image Billing and Retries > Final image token prices

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-billing.md

Credits per one million tokens on the named native adapter. Generation and the listed edit keys share these rates. A dash means that token category is not offered on that route.

| Model | Adapter | Token category | Input | Cached input | Output |
| --- | --- | --- | --- | --- | --- |
| `GPTIMAGE2.5 / GPTIMAGE2.5EDIT` | OpenAI | Text tokens | 600 | — | — |
| `GPTIMAGE2.5 / GPTIMAGE2.5EDIT` | OpenAI | Image tokens | 960 | — | 3,600 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google global | Text tokens | 60 | 6 | 360 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google global | Image tokens | 60 | 6 | 7,200 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google regional | Text tokens | 66 | 6.6 | 396 |
| `NANOBANANA2 / NANOBANANA2EDIT` | Google regional | Image tokens | 66 | 6.6 | 7,920 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google global | Text tokens | 240 | 24 | 1,440 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google global | Image tokens | 240 | 24 | 14,400 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google regional | Text tokens | 264 | 26.4 | 1,584 |
| `NANOBANANAPRO / NANOBANANAPROEDIT` | Google regional | Image tokens | 264 | 26.4 | 15,840 |

Text output includes reasoning tokens when reported. The direct OpenAI Images API has no cached-input price.


<a id="document-46b66adf80d2fb570825d7077a7f11a4"></a>
## Image Billing and Retries > Final output image prices

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-billing.md

Credits per generated image on the listed native adapter and configuration.

| Model | Adapter | Configuration | Credits / output image |
| --- | --- | --- | --- |
| `DALLE3` | OpenAI | Standard · 1024×1024 | 4.8 |
| `DALLE3` | OpenAI | Standard · 1792×1024 or 1024×1792 | 9.6 |
| `IMAGEN3` | Google | Standard generation | 4.8 |
| `IMAGEN3FLASH` | Google | Fast generation | 2.4 |
| `WAN2.7PRO` | Alibaba international | 1K | 9 |
| `QWENIMAGE3PRO` | Alibaba international | 1K | 4.8 |
| `QWENIMAGE3PRO` | Alibaba international | 2K | 9 |
| `WAN2.7PRO` | Alibaba China / global | 1K | 8.25132 |
| `QWENIMAGE3PRO` | Alibaba China / global | 1K | 4.1256 |
| `QWENIMAGE3PRO` | Alibaba China / global | 2K | 8.25132 |

Supported Fal image models have separate [final model-call rates](https://docs.samsar.one/pricing#image-models). Some model/configuration routes lack verified tariffs and stop before a new paid submission; this does not disable those keys on other adapters or fixed-price agent workflows. Other adapter routes report their configuration-specific charge in the completion receipt.


<a id="document-93a217c4272f7f0a7b1bbbd2fd817ba9"></a>
## Image Billing and Retries > Verification

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/image-billing.md

```bash
npm run test:image-billing --workspace services/processor
npm test --workspace services/generator
```

Regression coverage includes final image charges, native token categories, concurrent completions, settlement recovery, zero-charge results, image request keys, standalone routing, and protection for existing prepaid jobs and production agent stages.


<a id="document-6dd20f0ffaac2db6c4d02c2f08555db1"></a>
## Image Edit

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

The image API supports text-to-image, image enhancement, branding removal, image-list expansion into a generated set, title assignment, rollup banners, and status/listing endpoints. Requests are accepted by the processor and fulfilled by image generation workers.


<a id="document-3d99747f95afd4de51c6ee8a768e79bf"></a>
## Image Edit > Branding Removal

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `image_url` | Yes | Existing image to edit. |

The current route queues mode `NANOBANANA2EDIT`.


<a id="document-59fbf1e6315ef77a572210d28390bb50"></a>
## Image Edit > Docker Services

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/image-edit.md

| Service | Role |
| --- | --- |
| `processor` | Auth, validation, credit admission, ImageGeneration record creation, status and listing. |
| `generator` | Picks up image generation/edit sessions and calls configured image providers. |
| `mongo` | Image session, global session, user, and credit state. |
| `minio` and `media-gateway` | Local storage and the internal origin used for provider media access; browser assets are served through the processor. |


<a id="document-d9d8ffab0fd5e696cd15e5f343b8de92"></a>
## Image Edit > Enhance

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `image_url` | Yes | Existing image to enhance. |
| `resolution` | No | One of `0.5k`, `1k`, `2k`, `4k`. Defaults to `1k`. |
| `aspect_ratio` | No | Ratio string such as `16:9`, `9:16`, or `1:1`. Defaults to `16:9`. |

The current route queues mode `NANOBANANA2EDIT`.


<a id="document-fb87aec02cac398b608c991b42f7837f"></a>
## Image Edit > Final prices and completion billing

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

Generation, enhancement and image edits use the [final image token and output prices](image-billing.md#final-image-token-prices) for their selected model, adapter and configuration. There is no fixed enhancement or branding-removal fee per image. Poll status for the final charge; a pending submission is not a free completed call. Production agent pipelines keep their flat prices, and standalone Samsar.js calls receive one hosted charge.


<a id="document-2adff5c17747d8fb376d916dcd264d92"></a>
## Image Edit > Hosted Samsar.js

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

[Hosted Image API](https://docs.samsar.one/image-api) · [V2 edit routes](https://docs.samsar.one/v2#v2-image-edit-routes) · [Generation matrix](model-matrix.md#image) · [Editing matrix](model-matrix.md#image-edit)

Use hosted Samsar.js for common image operations, then expand into supported deployment adapters when needed.

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const job = await samsar.enhanceImage({
  image_url: 'https://example.com/product.jpg',
  resolution: '2k',
});
console.log(job.data.request_id);
```

The operation determines which edit contract is used. A general image-generation model key is not interchangeable with an edit-model key. The full matrix distinguishes both, along with native-only Qwen Image and custom endpoints.


<a id="document-941e907218e77553c62915e270068f4e"></a>
## Image Edit > Image Set Expansion

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `image_urls` | Yes | Non-empty array of image URLs. |
| `num_images` | Yes | Target output count. |
| `prompt` | No | User prompt to guide the generated set. |
| `metadata` | No | Context used for prompt generation. |
| `aspect_ratio` | No | Defaults to `1:1`. |

The processor first describes input images, builds a generation prompt, and queues an edit request with case type `image_list_to_image_set`.


<a id="document-0317963c7efde64e7d9574fd432a781c"></a>
## Image Edit > Main Endpoints

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/image/text_to_image` | Generate one or more images from a text prompt. Aliases: `/v1/image/generate`, `/v1/image/generations`. |
| `POST /v1/image/enhance` | Enhance/upscale an existing image URL. |
| `POST /v1/image/remove_branding` | Queue an edit that removes branding/watermark-like content from an image URL. |
| `POST /v1/image/add_image_set` | Expand a list of input images into a generated image set. |
| `POST /v1/image/assign_title` | Generate a title for an image from URL, multipart file, or raw image upload. |
| `GET /v1/image/status?request_id=...` | Poll image request status. |
| `GET /v1/image/list` | List image sessions for the authenticated user. |

`v2` delegates are also available for common external image routes, including `/v2/image/enhance`, `/v2/image/remove_branding`, `/v2/image/add_image_set`, `/v2/image/text_to_image`, and `/v2/external/image/status`.


<a id="document-145238ace6089e62886f4e4b77be74dc"></a>
## Image Edit > Provider Availability

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

Hosted image operations start with Samsar.js. For standalone, the [model matrix](model-matrix.md#image-edit) lists the exact Samsar, OpenAI, Google, fal and credential-scoped GenBlaze combinations; native Alibaba additionally supports its specific image models. In local Docker, rerun `npm run config:render` after changing providers and recreate the affected services.


<a id="document-8ca4a41384f749f4c195d38c28f02722"></a>
## Image Edit > Status and Listing

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

Use status polling after any queued image request:

```text
GET /v1/image/status?request_id=<request-id>
```

List sessions:

```text
GET /v1/image/list?case_type=image_enhance
```

Optional list query fields include `limit`, `case_type`, `rollup_ready`, and `include_rollup_ready`.


<a id="document-0e7324b647300aad3b48635b214b4966"></a>
## Image Edit > Text to Image

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-edit.md

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `prompt` | Yes | Source prompt. |
| `aspect_ratio` or `aspectRatio` | No | Defaults to `1:1`. |
| `model` or `mode` | No | Defaults to `NANOBANANA2`. |
| `num_images` or `numImages` | No | Positive number, defaults to one image. |
| `metadata` | No | Stored with the image request. |

The route creates an `ImageGeneration` record with operation type `GENERATE` and returns request/session identifiers for status polling.


<a id="document-5ce467b0e2ac811822247ec35858bf7d"></a>
## Image List to Video

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-list-to-video.md

Image-list-to-video creates an express video from existing image URLs plus prompt and metadata. It is also the core API path for ad-style videos with generated CTA/outro/footer assets.


<a id="document-46b808da063adc4ac82eea2f04f5f548"></a>
## Image List to Video > Ad Video and CTA Options

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-list-to-video.md

| Field | Meaning |
| --- | --- |
| `generate_outro_image` | Boolean. Generate an outro image. Defaults to true when CTA URL or CTA image data is provided. |
| `cta_url` or `ctaUrl` | HTTP/HTTPS CTA URL. Required when generated outro image is requested without an `outro_cta_image`. |
| `outro_cta_image` | Structured CTA image payload accepted by the video route. |
| `cta_text_top`, `cta_text_bottom`, `cta_logo` | Optional CTA text/logo fields. |
| `add_outro_animation` | Boolean. Defaults to true when generating an outro image. |
| `express_cta_generation`, `auto_generate_cta_text`, `generate_cta_texts` | Boolean aliases that enable express CTA generation. |
| `add_footer_animation` | Boolean footer animation control. |
| `footer_metadata` | Footer content/metadata. |
| `limit_single_narrator`, `add_narrator_avatar` | Narrator avatar controls. |


<a id="document-99d080a7a38b6c57be31c8ef791d9477"></a>
## Image List to Video > Common Optional Fields

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-list-to-video.md

| Field | Meaning |
| --- | --- |
| `prompt` | Creative direction for the generated video. |
| `metadata` | Structured business/product/context metadata. |
| `language` | Language for generated narration/subtitles where applicable. |
| `image_model` or `imageModel` | Optional model for explicit input-image enhancement. Existing prepared images are otherwise retained; CTA/outro composition does not depend on this model. |
| `aspect_ratio` or `aspectRatio` | `16:9` or `9:16`; defaults to `16:9`. |
| `enable_subtitles` or `add_subtitles` | Boolean. |
| `tts_model`, `ttsProvider`, `tts_provider` | Text-to-speech provider/model override. |
| `backingtrack_model`, `backing_track_model`, `music_provider` | Music/backing track override. |
| `inference_model` | Inference model override for narrative/planning steps. |
| `custom_adapters`, `configuration`, `model_config` | Custom model adapter configuration. |
| `webhookUrl` | Optional callback URL. |


<a id="document-5e7d1a2d7907ea0c886af14b2669b6e6"></a>
## Image List to Video > Docker Pipeline

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/image-list-to-video.md

1. `processor` authenticates and validates image URLs, provider availability, credits, model keys, aspect ratio, CTA/footer/narrator options, and request aliases.
2. Before returning, it downloads each input, inspects orientation and target coverage, center-crops only when the source can cover the target, uploads the prepared copy, and persists a durable builder job.
3. The async builder describes the prepared images on a best-effort basis, moderates the prompt, extracts a theme, and generates plus validates the narrative in up to five total attempts. Optional CTA copy retries once before deterministic fallback text is used.
4. It builds supplied-image scene layers plus any requested outro, footer, or narrator-avatar assets, then queues image readiness/enhancement work, speech, and one backing-music track. The initial audio path does not create sound effects.
5. `express-video-listener` joins the image, speech, and music gates and queues eligible motion layers; generated terminal outro layers skip AI-video generation.
6. `ai-video-layer-generator` handles provider motion and lip-sync work. The listener then runs reflow, conditional lip sync, sound-effect check/fallback, optional narrator avatar, and nonblocking transcript generation in order.
7. `frames-processor` creates linear or branch-path frame manifests, after which `video-generator` mixes enabled audio, renders with FFmpeg, uploads the final output, and persists its URL.
8. The listener finalizes stage billing, settlement, status, and the optional terminal webhook. `processor` serves local Docker outputs from the mounted volume under its configured `/assets_v2/...` URL (default `http://localhost:3002/assets_v2/...`).

The standard and `v2` alias routes share this full pipeline. The external-user route wraps the same pipeline with an external request/public ID. Step mode also uses the same builder and can pause before configured manual stages. The direct `/v2/external/video/image_to_video` and `/v2/external/video/direct_image_to_video` aliases are intentionally separate: they accept one image and queue only the direct AI-video clip path.


<a id="document-8560888daf18bae9493a28a65797d8ce"></a>
## Image List to Video > Endpoints

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-list-to-video.md

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/video/image_list_to_video` | Internal/authenticated user route. |
| `POST /v2/image_list_to_video` | `v2` alias delegated to the video route. |
| `POST /v1/external_users/image_list_to_video` | External-user scoped route. |
| `POST /v2/external/video/image_to_video` | Separate direct one-image AI-clip shortcut. It does not run the full image-list builder or media pipeline described below. |
| `POST /v2/external/video/direct_image_to_video` | Explicit alias for the same direct one-image AI-clip shortcut. |
| `POST /v2/video/step/image_to_video` | Step-video route for the full image-list builder. |
| `GET /v2/status`, `GET /v2/status_detailed` | Poll status for internal/API requests. |
| `GET /v1/external_users/status`, `GET /v1/external_users/status_detailed` | Poll external-user requests. |


<a id="document-accfc5380eb9c56d8356148a2bb11b3c"></a>
## Image List to Video > Hosted Samsar.js

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-list-to-video.md

[Hosted image-list API](https://docs.samsar.one/video#post-videoimage_list_to_video) · [Video model matrix](model-matrix.md#video) · [Image edit matrix](model-matrix.md#image-edit) · [Adapter deployment](providers-and-models.md)

Begin with the hosted SDK and public image URLs:

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const job = await samsar.createVideoFromImageList({
  image_urls: ['https://example.com/product-front.jpg', 'https://example.com/product-detail.jpg'],
  prompt: 'A concise product launch film with a clear final reveal.',
  video_model: 'RUNWAYML',
  aspect_ratio: '9:16',
});
console.log(job.data.request_id);
```

Replace the example URLs with reachable images you control. In standalone VidGenie, image-list mode also requires `NANOBANANAPROEDIT` for its edit stage; an I2V model alone is not the whole pipeline.


<a id="document-1e48ec79d4f75bef735b6a2bf72096dc"></a>
## Image List to Video > Required Fields

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-list-to-video.md

| Field | Meaning |
| --- | --- |
| `image_urls` | Non-empty array of fetchable URLs. Entries can be strings or objects containing `image_url`, `imageUrl`, `url`, `src`, `enhanced_url`, or `enhancedUrl`. |

`video_model` is optional. It defaults to `RUNWAYML` and, when provided, must be one of the configured image-list express video keys.

The route also accepts `input` wrapping, so both raw payloads and `{ "input": { ... } }` are supported.


<a id="document-a411ed4229ff19ab8d7dfabaa1ecf0eb"></a>
## Image List to Video > Supported Models

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/image-list-to-video.md

The [video matrix](model-matrix.md#video) lists every deployment video model and marks its Express/branching scope. Use `samsar.getSupportedTextToVideoModels()` for the target deployment’s current text-to-video and image-list-to-video selections. The [edit matrix](model-matrix.md#image-edit) covers the reference-image editing stage.

Samsar.js is the hosted entry point. Native or provider-only standalone choices remain scoped to their validated credentials: Qwen Image requires standard Alibaba pay-as-you-go access; Seedance 2.0 uses fal or its exact validated GenBlaze route. See [pricing](https://docs.samsar.one/pricing) for hosted model rates and [adapter routing](providers-and-models.md) for standalone behavior.


<a id="document-fbafb2746c7e64d07d698b4bd50dfa0f"></a>
## Model matrix

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Start with [hosted Samsar Studio](https://app.samsar.one) or [samsar-js](https://www.npmjs.com/package/samsar-js). The tables below cover every model in the standalone setup registry, then identify additional Studio catalog entries and service-specific models separately.

**Read across a row:** choose the Samsar request key, open its API reference, then expand into a supported deployment adapter. Samsar.js appears first for media; native inference adapters may lead the inference rows. This is documentation order, not an override of your saved runtime priority.

**Availability is scoped.** “Samsar” means a managed route is documented or registered, not a live health check. “Deployment only” requires a local adapter. “Studio catalog” entries are not a claim of current endpoint availability. Express and branching are separate allowlists, and their runtime responses can narrow the lists further.

[Hosted API overview](https://docs.samsar.one/) · [Pricing](https://docs.samsar.one/pricing) · [Provider setup and routing](providers-and-models.md) · [Setup wizard](setup-wizard.md)


<a id="document-a95f1d36338e1a1c26636cf1988b760a"></a>
## Model matrix > Catalog maintenance

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

This page is generated from the setup registry, processor model catalogs, Express allowlist and branching allowlist, with explanations in `docs/model-catalog.mjs`. It does not query providers or submit paid jobs.

```bash
node scripts/generate-model-docs.mjs
node scripts/generate-model-docs.mjs --check
```

Maintainers working in the parent workspace can also refresh the docs website snapshot with `SAMSAR_SOURCE_ROOT=.. node scripts/generate-model-docs.mjs --docs-site ../samsar-docs`. The docs website builds from that committed snapshot and does not require a sibling checkout.


<a id="document-6dd7b0175c0b1aa352d3ba2143817c18"></a>
## Model matrix > Check your deployment

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

For hosted Express workflows, inspect `await samsar.getSupportedTextToVideoModels()`. For a standalone installation, query the same route on your processor:

```bash
curl http://localhost:3002/v1/video/supported_models
```

This endpoint describes Express workflows; it is not the complete Studio or audio catalog. Review `runtime/config/available-models.json` and **Settings → Model Adapters** for your local installation. GenBlaze routes additionally depend on the exact validated credential catalog.

The stable setup key `KIMIK3` is submitted as `kimi-k3` in inference requests. Legacy `gpt-5.6-sol` records normalize to `gpt-6-astra`. GPT 6.1 Sol and Claude Fable 5.1 are independent choices alongside Astra and Opus. All four support `effort: "high"` or `effort: "xhigh"`; defaults remain Astra and High. Stable media keys can retain their spelling when the underlying provider model is upgraded.


<a id="document-eeda66d08f1523b0569623e78694e857"></a>
## Model matrix > Choose a modality

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

- [Inference & vision](#inference) — Plan scenes, understand images, write copy and build assistants.
- [Image generation](#image) — Create scene images, illustrations and reusable visual assets.
- [Image editing](#image-edit) — Edit reference images, remove objects and fill selected regions.
- [Video generation](#video) — Generate motion from text, an image or first and last frames.
- [Speech](#speech) — Turn dialogue into narration and voice tracks.
- [Music](#music) — Generate a backing track for your video or an audio asset.
- [Lip sync](#lip-sync) — Match a visible speaker to a supplied audio track.
- [Sound effects](#sound) — Add sound to an existing video or generate an audio effect.
- [Embeddings & search](#embeddings) — Index content for semantic search and recommendations.
- [Transcription](#transcription) — Align speech with text for transcripts and subtitles.


<a id="document-f769245a4861be0f093bcdd19f7c7fa6"></a>
## Model matrix > Embeddings & search

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Index content for semantic search and recommendations.

**Request field:** Managed embedding model. [Samsar API reference](https://docs.samsar.one/chat-api#post-chatcreate_embedding).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| OpenAI embeddings · `text-embedding-3-large` | [Samsar.js](https://docs.samsar.one/chat-api#post-chatcreate_embedding) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) | Modality API / Studio | Hosted search is accessed through Samsar.js. Local indexing still requires OPENAI_API_KEY; crawling URLs also requires FIRECRAWL_API_KEY. |


<a id="document-221b6e35f1f3e75fc742a70b9c74f9bb"></a>
## Model matrix > Image editing

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Edit reference images, remove objects and fill selected regions.

**Request field:** Route-specific edit model. [Samsar API reference](https://docs.samsar.one/v2#v2-image-edit-routes).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| GPTImage 2.6 Edit · `GPTIMAGE2.5EDIT` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) | Modality API / Studio | Stable Samsar key for GPTImage 2.6 Sunburst editing. Legacy GenBlaze routes are excluded. |
| NanoBanana 2 Edit · `NANOBANANA2EDIT` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Used by image enhancement and branding removal. Multi-output image-set jobs bypass GenBlaze. |
| NanoBanana Pro Edit · `NANOBANANAPROEDIT` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Required by VidGenie image-list mode. Multi-output image-set jobs bypass GenBlaze. |
| Bria Eraser · `BRIA_ERASER` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Bria GenFill · `BRIA_GENFILL` | [Samsar.js](https://docs.samsar.one/v2#v2-image-edit-routes) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |

Additional image editing entries in the Studio source catalog (3)

Outside the standalone setup registry; check target deployment availability. Workflow badges follow the source allowlists.

| Model | Catalog key | Workflow scope |
| --- | --- | --- |
| Flux-1 Pro Fill | `FLUX1PROFILL` | Studio |
| Flux-1.1 Pro Ultra Redux | `FLUX1.1PROULTRAREDUX` | Studio |
| Flux-1.1 Pro Redux | `FLUX1.1PROREDUX` | Studio |


<a id="document-c510e06a841c8cc5ac529b84dabf2922"></a>
## Model matrix > Image generation

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Create scene images, illustrations and reusable visual assets.

**Request field:** image_model (workflow) / model (image). [Samsar API reference](https://docs.samsar.one/image-api#post-imagetext_to_image).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Qwen Image 3.0 Pro · `QWENIMAGE3PRO` | Deployment only | [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) | Express | Standalone native adapter only. Requires Alibaba standard pay-as-you-go credentials; Token Plan credentials do not enable it. |
| GPTImage 2.6 · `GPTIMAGE2.5` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Stable Samsar key for GPTImage 2.6 Sunburst. Legacy GenBlaze GPT Image 2 routes are excluded from this model. |
| Seedream 5 Pro · `SEEDREAM` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | Stable key currently maps to Seedream 5 Pro. |
| NanoBanana 2 · `NANOBANANA2` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Image generation catalog model; not in the current Express image allowlist. |
| NanoBanana Pro · `NANOBANANAPRO` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| Wan2.7 Pro · `WAN2.7PRO` | [Samsar.js](https://docs.samsar.one/image-api#post-imagetext_to_image) | [Samsar.js](https://docs.samsar.one/external-requests) · [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) · [fal](https://fal.ai/docs/documentation) | Express | Enable a supported adapter and check the target deployment before selecting this model. |
| Custom image endpoint · `CUSTOM_TEXT_TO_IMAGE:<adapter-id>` | Deployment only | [Custom endpoint](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) | Custom endpoint | Register a named standalone image adapter; use the exact returned key. Includes the optional Vast.ai FLUX.2 utility. |

Additional image generation entries in the Studio source catalog (17)

Outside the standalone setup registry; check target deployment availability. Workflow badges follow the source allowlists.

| Model | Catalog key | Workflow scope |
| --- | --- | --- |
| F-Lite | `FLITE` | Studio |
| Google Imagen3 | `IMAGEN3` | Studio |
| Flux-1.1 Pro | `FLUX1.1PRO` | Studio |
| Dall-E 3 | `DALLE3` | Studio |
| Flux-1 Pro | `FLUX1PRO` | Studio |
| Flux 1.1 Ultra | `FLUX1.1ULTRA` | Studio |
| Flux-1 Dev | `FLUX1DEV` | Studio |
| Recraft V3 | `RECRAFTV3` | Studio |
| Stable Diffusion V3.5 | `SDV3.5` | Studio |
| Sana 4.5B | `SANA4.5B` | Studio |
| Sana Sprint | `SANASPRINT` | Studio |
| Recraft 20B | `RECRAFT20B` | Studio |
| Lumalabs Photon | `PHOTON` | Studio |
| Lumalabs Photon Flash | `PHOTONFLASH` | Studio |
| Lumina V2 | `LUMINAV2` | Studio |
| Ideogram V3 | `IDEOGRAMV3` | Studio |
| HiDream I1 | `HIDREAMI1` | Studio |


<a id="document-eac54ba8ed85a280cc7c4fc5f26d57ab"></a>
## Model matrix > Inference & vision

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Plan scenes, understand images, write copy and build assistants.

**Request field:** inference_model (workflow) / model (chat). [Samsar API reference](https://docs.samsar.one/external-requests#chat).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| GPT 6 Astra · `gpt-6-astra` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [OpenAI](https://platform.openai.com/docs/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Default GPT model. Supports high and xhigh effort. Legacy gpt-5.6-sol choices still normalize to Astra; GPT 6.1 Sol is a separate choice. GenBlaze requires an exact validated mapping. |
| GPT 6.1 Sol · `gpt-6.1-sol` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [OpenAI](https://platform.openai.com/docs/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Supports text inference and vision with high or xhigh effort. Native OpenAI, OpenRouter, and Samsar adapters. |
| Claude Opus 5.5 · `claude-opus-5.5` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Anthropic](https://platform.claude.com/docs/en/api/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Supports text inference and vision with high or xhigh effort. Native Anthropic, OpenRouter, and Samsar adapters. |
| Claude Fable 5.1 · `claude-fable-5.1` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Anthropic](https://platform.claude.com/docs/en/api/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Supports text inference and vision with high or xhigh effort. Native Anthropic uses claude-fable-5-1; OpenRouter uses anthropic/claude-fable-5.1. |
| Gemini 4 Argon · `gemini-4-argon` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kimi K3 · `kimi-k3` (setup: `KIMIK3`) | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Kimi](https://platform.kimi.ai/docs/overview) · [Samsar.js](https://docs.samsar.one/external-requests) | Modality API / Studio | Setup key KIMIK3; inference requests use kimi-k3. Native Kimi first, then Samsar; OpenRouter is not in this chain. |
| Qwen 3.8 Max · `QWEN3.8` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) · [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Modality API / Studio | Native Alibaba is a Docker option. Hosted Qwen uses OpenRouter internally; callers still use Samsar.js. |
| GPT 6 Astra · extra high reasoning · `gpt-6-astra-xhigh` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [OpenAI](https://platform.openai.com/docs/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Reasoning option on GPT 6 Astra; providers receive the base model with xhigh effort. Omitted from the normal runtime catalog. |
| GPT 6.1 Sol · extra high reasoning · `gpt-6.1-sol-xhigh` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [OpenAI](https://platform.openai.com/docs/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Reasoning option on GPT 6.1 Sol; providers receive the base model with xhigh effort. Omitted from the normal runtime catalog. |
| Claude Fable 5.1 · extra high reasoning · `claude-fable-5.1-xhigh` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Anthropic](https://platform.claude.com/docs/en/api/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Reasoning option on Claude Fable 5.1; providers receive the base model with xhigh effort. Omitted from the normal runtime catalog. |
| Claude Opus 5.5 · extra high reasoning · `claude-opus-5.5-xhigh` | [Samsar.js](https://docs.samsar.one/external-requests#chat) | [Anthropic](https://platform.claude.com/docs/en/api/overview) · [Samsar.js](https://docs.samsar.one/external-requests) · [OpenRouter](https://openrouter.ai/docs/quickstart) | Branching | Reasoning option on Claude Opus 5.5; providers receive the base model with xhigh effort. Omitted from the normal runtime catalog. |


<a id="document-41025ef4b53fca3b8b5ee1ca8dac72e1"></a>
## Model matrix > Lip sync

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Match a visible speaker to a supplied audio track.

**Request field:** lip_sync_model. [Samsar API reference](https://docs.samsar.one/external-requests#video).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Sync Lip Sync · `SYNCLIPSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| LatentSync · `LATENTSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling Lip Sync · `KLINGLIPSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Hummingbird Lip Sync · `HUMMINGBIRDLIPSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Creatify Lip Sync · `CREATIFYLIPSYNC` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |


<a id="document-1ea026cbb1c4f639cf705147af4c0c3a"></a>
## Model matrix > Music

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Generate a backing track for your video or an audio asset.

**Request field:** backingtrack_model / model. [Samsar API reference](https://docs.samsar.one/external-requests#audio).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Lyria 3 · `LYRIA3` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Google music credential validation can change the runtime order between Google and fal. |
| ElevenLabs Music · `ELEVENLABS_MUSIC` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [ElevenLabs](https://elevenlabs.io/docs/overview/intro) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Custom music endpoint · `CUSTOM_TEXT_TO_MUSIC` | Deployment only | [Custom endpoint](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) | Custom endpoint | Requires a compatible configured text-to-music endpoint. |

Additional music entries in the Studio source catalog (2)

Outside the standalone setup registry; check target deployment availability. Workflow badges follow the source allowlists.

| Model | Catalog key | Workflow scope |
| --- | --- | --- |
| AudioCraft | `AUDIOCRAFT` | Studio |
| Cassette AI | `CASSETTEAI` | Studio |


<a id="document-69ffe1f4aabbe59daeda904ec0d6a37b"></a>
## Model matrix > Sound effects

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Add sound to an existing video or generate an audio effect.

**Request field:** sound_effect_model. [Samsar API reference](https://docs.samsar.one/external-requests#video).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| MMAudio V2 · `MMAUDIOV2` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Video-conditioned sound. This is separate from the audio-only SDAUDIO route. |
| Mirelo AI · `MIRELOAI` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Video-conditioned sound. Provide a video URL and the desired sound prompt. |
| Audio sound effects · `SDAUDIO` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) | Modality API / Studio | Hosted text-to-sound-effect audio route. Different from video-conditioned MMAudio and Mirelo. |


<a id="document-4fb93edecdd9f651cf34a06b12b224e5"></a>
## Model matrix > Speech

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Turn dialogue into narration and voice tracks.

**Request field:** tts_model / provider. [Samsar API reference](https://docs.samsar.one/external-requests#audio).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| OpenAI Text to Speech · `OPENAI` (setup: `OPENAI_TTS`) | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) | Modality API / Studio | Use OPENAI in the Express tts_model field. GenBlaze speech is conditional on an exact gpt-4o-mini-tts mapping. |
| Google Text to Speech · `GOOGLE` (setup: `GOOGLE_TTS`) | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) | Modality API / Studio | Use GOOGLE in the Express tts_model field. |
| ElevenLabs Speech · `ELEVENLABS` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Hosted audio accepts ELEVENLABS. The standalone setup registry enables this speech model through fal only. |
| PlayAI speech · `PLAYAI` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) | Modality API / Studio | Accepted by the hosted audio speech contract. Not advertised by the standalone setup matrix. |


<a id="document-62bee920ce5dfbdba1f9cf7c90ddf70e"></a>
## Model matrix > Transcription

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Align speech with text for transcripts and subtitles.

**Request field:** Managed transcription model. [Samsar API reference](https://docs.samsar.one/external-requests#audio).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Whisper transcript alignment · `whisper-1` | [Samsar.js](https://docs.samsar.one/external-requests#audio) | [Samsar.js](https://docs.samsar.one/external-requests) · [OpenAI](https://platform.openai.com/docs/overview) | Modality API / Studio | Managed transcript-alignment route; not a freely selectable Express inference model. |


<a id="document-2128ff7b195d445c2f81044a13362383"></a>
## Model matrix > Video generation

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/model-matrix.md

Generate motion from text, an image or first and last frames.

**Request field:** video_model. [Samsar API reference](https://docs.samsar.one/external-requests#video).

| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |
| --- | --- | --- | --- | --- |
| Runway Gen-4 · `RUNWAYML` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Runway](https://docs.dev.runwayml.com/) | Express | Express turns planned scene images into motion. This is different from a raw text-to-video model call. |
| Veo3.1 · `VEO3.1` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Text-to-video model; the I2V variants have separate keys. |
| Veo3.1 Fast · `VEO3.1FAST` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Fast text-to-video model; use VEO3.1I2VFAST for Express scene animation. |
| VEO3.1 Img2Vid · `VEO3.1I2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| VEO3.1 Fast Img2Vid · `VEO3.1I2VFAST` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| VEO3.1 Frame to Video · `VEO3.1FLIV` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | First/last-frame generation; not an Express video selection. |
| Nvidia Cosmos 3 · `COSMOS3SUPERI2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Enable a supported adapter and check the target deployment before selecting this model. |
| Seedance 1.5 I2V · `SEEDANCEI2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | Enable a supported adapter and check the target deployment before selecting this model. |
| Seedance 2.0 I2V · `SEEDANCE2.0I2V` | Deployment only | [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express · Branching | Standalone provider-billed I2V. Exact GenBlaze route: seedance-2-0-260128. No Samsar adapter in the setup catalog. |
| Seedance 2.5 I2V · `SEEDANCE2.5I2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | 5, 10 or 15 second 720p scene buckets. Exact GenBlaze route: seedance-2-5-260628. Hosted worker uses GMICloud internally. |
| Kling 4 I2V (legacy 3 Pro key) · `KLINGIMGTOVID3PRO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Legacy setup/request alias: new requests normalize to KLINGIMGTOVID4. Previously submitted jobs retain their saved endpoint. Registry adapters shown here do not guarantee Kling 4 availability. |
| Kling 4 I2V (legacy Turbo key) · `KLINGIMGTOVIDTURBO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Legacy setup/request alias: new requests normalize to KLINGIMGTOVID4. Previously submitted jobs retain their saved endpoint. Registry adapters shown here do not guarantee Kling 4 availability. |
| Kling 1.6 Pro · `KLINGIMGTOVIDPRO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling 2.1 Master · `KLINGIMGTOVID2.1MASTER` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling 2.1 Pro · `KLINGIMGTOVID2.1PRO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Kling 2.1 Standard · `KLINGIMGTOVID2.1STANDARD` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Hailuo 02 Pro · `HAILUOPRO` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Modality API / Studio | Enable a supported adapter and check the target deployment before selecting this model. |
| Happy Horse 1.1 I2V · `HAPPYHORSEI2V` | [Samsar.js](https://docs.samsar.one/external-requests#video) | [Samsar.js](https://docs.samsar.one/external-requests) · [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) · [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [fal](https://fal.ai/docs/documentation) | Express | Stable key currently maps to Happy Horse 1.1 I2V. |
| Custom video endpoint · `CUSTOM_IMAGE_TO_VIDEO` | Deployment only | [Custom endpoint](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) | Custom endpoint | Requires a compatible standalone image-to-video adapter and its configured authorization. |

Additional video generation entries in the Studio source catalog (12)

Outside the standalone setup registry; check target deployment availability. Workflow badges follow the source allowlists.

| Model | Catalog key | Workflow scope |
| --- | --- | --- |
| Kling 4 Img2Vid | `KLINGIMGTOVID4` | Express |
| Kling 4 Text2Vid | `KLINGTXTTOVID4` | Studio |
| SD Video | `SDVIDEO` | Studio |
| Haiper 2.0 | `HAIPER2.0` | Studio |
| Skyreels-i2v | `SKYREELSI2V` | Studio |
| Veo2 | `VEO` | Studio |
| Veo2 Img2Vid | `VEOI2V` | Studio |
| PixVerseV4.5 | `PIXVERSEI2V` | Studio |
| PixVerseV4.5 Fast | `PIXVERSEI2VFAST` | Studio |
| Pika2.2 I2V | `PIKA2.2I2V` | Studio |
| Magi Distilled | `MAGIDISTILLED` | Studio |
| Vidu Img2Vid | `VIDUI2V` | Studio |


<a id="document-6565d72ece85ff1ce0386ac3721ff1ed"></a>
## Providers and Models

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

Begin with **[hosted Samsar.js](https://docs.samsar.one/)** for managed workflows. Choose a model in the [full matrix](model-matrix.md), read its [API contract](https://docs.samsar.one/), then configure a standalone adapter only when you need it. Native inference and custom model endpoints can lead their own model-specific paths.

For standalone deployments, provider configuration is driven by `runtime/config/samsar.config.json` or the setup wizard. `npm run config:render` converts enabled providers into runtime env and `runtime/config/available-models.json`. The documentation presents Samsar.js first; the runtime follows validated configuration and saved model preferences.


<a id="document-414af68b9c959e3e0ea83288a91764d2"></a>
## Providers and Models > AI-Video Pricing Across Adapters

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

Studio, direct hosted calls and rerolls use the [final AI-video output prices](video-model-billing.md#final-ai-video-output-prices) for the named adapter and configuration. Lip-sync and video sound-effect layers report configuration-specific final prices in completion receipts. Production agent workflows retain their fixed stage prices. Standalone Samsar.js calls receive one hosted charge, with no local credit debit.


<a id="document-500a3a3d91e49b730513098f61a99388"></a>
## Providers and Models > Assistant Pricing Across Adapters

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

See the [final input, output, and cached-input token prices](assistant-billing.md#final-token-prices), in credits per one million tokens. Prices apply to the listed model, adapter, context, and date period; another adapter route may have different final prices.

Production agent pipeline inference keeps its flat stage pricing. Standalone Studio queued assistants retain their local-credit waiver, while calls to hosted Samsar assistant endpoints consume hosted credits. See [Assistant billing and retries](assistant-billing.md) for SDK examples, credit receipts, and pending requests.


<a id="document-718424f76ca32a9e179ad51af9a78342"></a>
## Providers and Models > Fallback Rules

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

Hosted clients continue to call Samsar.js regardless of the upstream provider used internally. Standalone routing is model-specific: it combines native adapters, the Samsar adapter, optional provider routes and saved administrator preferences.

| Area | Runtime behavior |
| --- | --- |
| Native inference | The model’s native adapter can lead its chain. Use the generated priority and **Settings → Model Adapters** to see the effective order; GMICloud and OpenRouter are supported only for their mapped models. |
| Kimi K3 | Native Kimi first, Samsar alternative. No OpenRouter fallback. Text, vision and structured output use the same selected model. |
| Hosted Qwen | Non-Docker hosted runtimes route `QWEN3.8` through OpenRouter internally. Native Alibaba credentials do not override that hosted rule. |
| Docker Qwen | Native Alibaba is available; `SAMSAR_QWEN_OPENROUTER_ONLY=true` can force the OpenRouter policy. |
| Qwen Image | `QWENIMAGE3PRO` is native Alibaba only, with standard pay-as-you-go credentials. |
| Express media | Supported Samsar, native and custom adapters depend on the selected model. An accepted asynchronous job stays pinned to its submitting adapter while polling. |
| GMICloud / GenBlaze | Exact credential-validated model and operation mappings are required. An approximate model match is not used as a substitute. |
| Claude | Native Anthropic is preferred when `ANTHROPIC_API_KEY` is configured, including hosted production. Explicit routing and standalone saved preferences still apply. |
| Kling 4 | Use `KLINGIMGTOVID4` or `KLINGTXTTOVID4`; 720p, no native audio, and 5–30 seconds in five-second steps. Old 3 Pro/Turbo keys normalize for new requests; accepted jobs keep their saved endpoint. |
| GPTImage 2.6 | `GPTIMAGE2.5` and `GPTIMAGE2.5EDIT` exclude legacy GenBlaze GPT Image 2 routes. |

Current embedding/search implementation note: although the setup availability matrix includes `search` and `recommendations` for Samsar, `EmbeddingService` calls OpenAI embeddings directly with `text-embedding-3-large` and checks `OPENAI_API_KEY`. URL crawling also requires `FIRECRAWL_API_KEY`.


<a id="document-f779bd5e19c4e029775c3cec6ebaab75"></a>
## Providers and Models > Generated Availability

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

The renderer script builds availability by unioning enabled provider capabilities:

```bash
npm run config:render
cat runtime/config/available-models.json
```

The generated file contains:

| Key | Meaning |
| --- | --- |
| `providers` | Enabled provider keys. |
| `models` | Available model identifiers from enabled providers. |
| `actions` | Available action families such as `chat`, `image`, `video`, `search`, `recommendations`, `audio`, `lip_sync`, and `sound_effect`. |
| `modelProviderPriority` | Default compatible adapter order for each model. |
| `audio` | Derived audio provider availability for TTS, music, and sound effects. |

The video API reads this file through `DeploymentModelConfig` and filters `GET /v1/video/supported_models` responses to the deployment's available models.


<a id="document-d74e9561dfa0bd38f39281685b250bc3"></a>
## Providers and Models > Image Pricing Across Adapters

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

Image model calls use the [final image token and output prices](https://docs.samsar.one/pricing#image-models) for the listed routes and are charged on completion. See [Image billing and retries](image-billing.md) for standalone Samsar.js routing and deployment configuration.


<a id="document-da6dcf1e6f05edb23b300eee986740bd"></a>
## Providers and Models > Kimi K3 Adapter

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

`KIMIK3` is the stable setup/runtime model key and `kimi-k3` is the exact native provider model. Native requests use `https://api.moonshot.ai/v1`, always set high reasoning, normalize developer messages to system messages, and remove sampling fields that Kimi fixes internally. Structured-output requests preserve the existing response contract and force strict JSON schemas. Vision uses the same model: public images are converted to inline data, while supported video inputs are uploaded and referenced through Kimi file storage.

The runtime renderer writes `KIMI_K3_API_KEY` once into mode-`0600` `runtime/secrets/root.env`. Compose shares that env with `processor`, `generator`, `audio-generator`, `ai-video-layer-generator`, `express-video-listener`, and `assistant-query-processor`.


<a id="document-087a15dca50718f04f9db011a6978b7d"></a>
## Providers and Models > Local Verification

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

After the stack is running:

```bash
curl http://localhost:3002/v1/video/supported_models
```

Use this response as the source of truth for the current Docker runtime. If a model is missing, check that the provider is enabled in `runtime/config/samsar.config.json`, rerun `npm run config:render`, and recreate the containers that need the updated env.


<a id="document-bfdc3a958ba16b64838a231f0ac85d5c"></a>
## Providers and Models > Model Groups Used by Video APIs

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

Use the stable keys `GPTIMAGE2.5` for GPTImage 2.6 Sunburst (High) and `GPTIMAGE2.5EDIT` for editing. OpenAI generation and editing use `gpt-image-2.6-sunburst`; fal generation uses `openai/gpt-image-2.6/sunburst/text-to-image`. The request keys and Studio price tables are unchanged. Queued 2.5 jobs keep their submitted model or endpoint. Retired `GPTIMAGE2` and `GPTIMAGE2EDIT` keys are rejected for new requests. Other model keys remain stable: `SEEDREAM` → Seedream 5 Pro; `HAPPYHORSEI2V` → Happy Horse 1.1 I2V.

| Workflow | Selection rule | Reference |
| --- | --- | --- |
| Express image generation | Uses the explicit Express image allowlist; Qwen Image additionally requires its native standalone adapter. Nano Banana 2 is in the general image catalog but not the current Express list. | [Image matrix](model-matrix.md#image) |
| Express motion | Uses the Express video allowlist, filtered for the target deployment. Seedance 2.0 is provider-billed standalone. | [Video matrix](model-matrix.md#video) |
| Branching narrative | Uses a narrower inference, image and video allowlist. Do not copy every Express model into a branching request. | [Narrative API](https://docs.samsar.one/narrative) · [Branching flags](model-matrix.md) |
| Speech and music | Express `tts_model` uses `OPENAI`, `GOOGLE`, `ELEVENLABS`; `backingtrack_model` uses `LYRIA3` or `ELEVENLABS_MUSIC`. | [Audio guide](audio-and-performance.md) |
| Lip sync and video sound | Separate model fields and video-operation routes. These are not interchangeable with an audio-only generation request. | [Lip sync](model-matrix.md#lip-sync) · [Sound](model-matrix.md#sound) |

[Discover Express model availability](https://docs.samsar.one/video#get-videosupported_models) with `samsar.getSupportedTextToVideoModels()`. For every setup model, its API link and supported adapters, use the [generated full model matrix](model-matrix.md).


<a id="document-aaef9c39123be7918e8f6b5f85953b6b"></a>
## Providers and Models > OpenRouter Qwen Adapter

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

`QWEN3.8` is the stable public model key. The OpenRouter adapter uses the same provider model for text and vision requests:

| Request | Default OpenRouter model |
| --- | --- |
| Text only | `qwen/qwen3.8-max` |
| Contains image or video input | `qwen/qwen3.8-max` |

`OPENROUTER_QWEN_38_MAX_MODEL` overrides that mapping. Native Alibaba routing uses `qwen3.8-max` for text and vision, including Docker installations configured with a Token Plan endpoint; the renderer writes that shared selection as `ALIBABA_QWEN_MODEL`. GPT and Claude requests preserve the selected `high` or `xhigh` effort. Qwen and Gemini use their adapter reasoning settings. Completion limits and timeouts are model-specific; Qwen has a 10-minute minimum timeout.

Billed assistant requests disable hidden SDK retries and recover settlement from the saved response. An ambiguous timeout or reset is retained for reconciliation instead of automatically dispatching another billable call. Other inference callers retain their configured adapter retry policies. Payment-required and insufficient-credit failures do not trigger provider retries. See [Assistant billing and retries](assistant-billing.md#retries-and-settlement).

The adapter policy is shared by the processor, generator, audio generator, AI video layer generator, express video listener, and assistant query processor. `configuration.custom_adapters` is a separate media-operation feature and cannot override the hosted Qwen inference route.


<a id="document-dee11b061c131e244b0121a5ccff098a"></a>
## Providers and Models > Provider Matrix

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

| Adapter / provider docs | Credential | How it fits |
| --- | --- | --- |
| [Samsar.js](https://docs.samsar.one/external-requests) | `SAMSAR_API_KEY` | Call the hosted Samsar service using Samsar credits. The samsar-js client is the common entry point. |
| [OpenAI](https://platform.openai.com/docs/overview) | `OPENAI_API_KEY` | Native GPT inference, image and speech adapters; also required for local embedding indexes. |
| [Anthropic](https://platform.claude.com/docs/en/api/overview) | `ANTHROPIC_API_KEY` | Native Claude inference and assistant adapter. |
| [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) | `Google service account / configured Google credentials` | Gemini, Nano Banana, Veo, Google speech and Lyria. Music credentials and model access are validated separately. |
| [Kimi](https://platform.kimi.ai/docs/overview) | `KIMI_K3_API_KEY` | Native Kimi text, vision and structured output; Samsar is the supported alternative. |
| [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) | `ALIBABA_API_KEY` | Native Qwen inference in Docker, Qwen Image, Wan and Happy Horse. Qwen Image requires standard pay-as-you-go access. |
| [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [GenBlaze source](https://github.com/backblaze-labs/genblaze) | `GMI_API_KEY` | Only exact model and operation mappings validated for your credential are enabled by the local GenBlaze gateway. |
| [fal](https://fal.ai/docs/documentation) | `FAL_API_KEY` | Supported media, speech, music, lip-sync and sound-effect adapters. |
| [OpenRouter](https://openrouter.ai/docs/quickstart) | `OPENROUTER_API_KEY` | Supported inference and vision routes. This does not enable image, video or audio generation. |
| [ElevenLabs](https://elevenlabs.io/docs/overview/intro) | `ELEVENLABS_API_KEY` | Direct music adapter. Speech is enabled through fal in the setup registry; do not assume a direct key enables every speech route. |
| [Runway](https://docs.dev.runwayml.com/) | `RUNWAY_API_KEY` | Native Runway video adapter. |
| [Custom endpoint](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) | `Adapter URL and server-side authorization` | Register a compatible endpoint in your standalone deployment. Available only after configuration. |

The [per-model matrix](model-matrix.md) is the compatibility reference. A provider key does not enable every model from that provider. The Samsar adapter is not universal: Qwen Image 3.0 Pro and Seedance 2.0 have native/provider-only setup paths, and some Studio catalog entries are not advertised by setup.

Hosted client or standalone Samsar adapter?

- **Hosted client:** initialize `new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY })`. Requests go to `https://api.samsar.one/v1` by default. Samsar manages its upstream providers.
- **Standalone with Samsar adapter:** configure `SAMSAR_API_KEY` in the wizard so local workers can call supported hosted generation/inference operations through Samsar.js.
- **Standalone API client:** set `baseUrl: 'http://localhost:3002/v1'` and use an API credential accepted by your local processor. Provider credentials belong in the local setup configuration.

[External requests API and SDK examples](https://docs.samsar.one/external-requests#samsar-js).


<a id="document-37549a6e439d9a0455e41a6130a358d5"></a>
## Providers and Models > Standalone Model Adapter Preferences

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/providers-and-models.md

The standalone administrator can open **Settings > Model Adapters** in the Samsar client to reorder the installed adapters for inference, text-to-image, and image-to-video models. Only models and adapters available in the current installation are shown.

The default order comes from `runtime/config/available-models.json`. Saved overrides are written atomically to `runtime/config/model-adapter-preferences.json`; rerunning `npm run config:render` does not overwrite that file. Resetting the setup wizard removes it together with the other generated runtime configuration.

For Text to Video, Image List to Video, and Studio work, a new request starts with the first configured adapter. A definitive provider failure advances the retry to the next configured adapter. Requests already submitted to an asynchronous provider remain pinned to that provider while polling, so changing the preference order cannot redirect an in-flight request.

This preference file is read only when `SAMSAR_DEPLOYMENT_EDITION=standalone`. Production and staging deployments keep their existing provider-routing behavior, and their settings UI does not expose this control.


<a id="document-ab99806403ef54d80c3e2e8605746b28"></a>
## README

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/README.md

<h1 align="center">



</h1>

  Samsar is a generative video and media automation platform for turning prompts, product images, structured content, and creative ideas into finished videos and reusable studio assets.

  It brings together one-shot text-to-video, image-list-to-video, image editing, audio generation, semantic search, recommendations, assistant workflows, multi-provider model routing, and detailed post-production controls across one integrated Studio and API surface.

  Production app
  ·
  Production API docs
  ·
  Demo channel
  ·
  Setup wizard








  Features
  ·
  Quick start
  ·
  Workflows
  ·
  Documentation
  ·
  Adapters
  ·
  API
  ·
  Operations

---


<a id="document-9d8b30573c77cd79ffc34d51605aa0a7"></a>
## Recommendations

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/recommendations.md

Recommendations use the same embedding templates and semantic-search implementation as search. The recommendation endpoints configure that shared path for reference-item similarity and return compact `{id, score}` matches. This is useful for product recommendations, content similarity, lead matching, related items, and "more like this" flows.


<a id="document-a4e548839fd6eeca038b8ba4594689c2"></a>
## Recommendations > Docker Services

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/recommendations.md

| Service | Role |
| --- | --- |
| `processor` | Auth, similarity query validation, recommendation matching, credit headers. |
| `mongo` | Embedding templates and source records. |
| Provider | The current embedding/recommendation implementation requires `OPENAI_API_KEY`. |


<a id="document-296a378eea698efbc9cf5acbc376a994"></a>
## Recommendations > Endpoints

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/recommendations.md

```text
POST /v1/chat/similar_to_embedding
POST /v1/chat/similar_to_embeddings
```

Both routes call the same recommendation handler.


<a id="document-dd8edacd81bc7015589554f7be40db58"></a>
## Recommendations > Hosted Samsar.js

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/recommendations.md

[Hosted similarity API](https://docs.samsar.one/chat-api#post-chatsimilar_to_embedding) · [Embedding matrix](model-matrix.md#embeddings) · [Create an index](search.md)

Start with the hosted client and an existing ready embedding template:

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const related = await samsar.similarToEmbedding({
  template_id: 'YOUR_READY_TEMPLATE_ID',
  search_json: { description: 'Quiet beachfront stays for a weekend trip' },
});
console.log(related.data);
```

Hosted Samsar manages the embedding infrastructure. If you choose a standalone deployment, follow the local provider requirements below; a generic inference adapter does not replace the embedding model.


<a id="document-6e2653a790b6778aa3c66512b58ae19c"></a>
## Recommendations > How It Differs From Search

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/recommendations.md

| Search | Recommendations |
| --- | --- |
| Uses `search_against_embeddings`. | Uses `similar_to_embeddings`. |
| Requires a text query. | Accepts a text query or structured record. |
| Returns `results`. | Returns `matches`. |
| Supports optional reranking and raw matching details. | Disables LLM reranking and raw details, relaxes strict prefiltering for inferred filters, and returns compact matches. Strict explicit filters can still be vector prefilters; configured soft keys are post-filtered. |


<a id="document-943832071decbe61187b9393c8ba3f88"></a>
## Recommendations > Optional Input

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/recommendations.md

| Field | Meaning |
| --- | --- |
| `search_params`, `search_filters`, `filter_payload`, `pre_filter` | Filter payload applied before/around similarity matching. |
| `filter_config`, `filter_options` | Controls how fields are interpreted. |
| `structured_filters` or `filters` | Explicit filters. |
| `search_date` | Date context for filters. |
| `limit` | Maximum matches to return. |
| `min_results` or `minResults` | Minimum desired result count. |
| `num_candidates` or `numCandidates` | Candidate pool before final result selection. |

Response shape:

```json
{
  "template_id": "...",
  "structured_filters": {},
  "matches": []
}
```


<a id="document-87244bbedd8171404a6638c8880b5d90"></a>
## Recommendations > Provider Availability

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/recommendations.md

The setup wizard lists recommendations under OpenAI and Samsar. The current recommendation route still uses the embedding service, which calls OpenAI embeddings directly. If the route fails in Docker because provider credentials are unavailable, set `OPENAI_API_KEY`, rerun `npm run config:render`, and recreate the processor container.


<a id="document-6de86d940560f752fb82dd94cc5cb19a"></a>
## Recommendations > Required Input

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/recommendations.md

| Field | Meaning |
| --- | --- |
| `template_id` | Template created by a search indexing endpoint. |
| `search_term` / `searchTerm` / `query` or `search_json` / `search_record` / `record` | The item, phrase, or structured object to match against the template. |

At least one query signal is required: a text search term or a structured search record.


<a id="document-f595ce2eb936ecbd64a7f6ca93458780"></a>
## Recommendations > Typical Flow

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/recommendations.md

1. Create a template with `POST /v1/chat/create_embedding` or `POST /v1/chat/generate_embeddings_from_plain_text`.
2. Store the returned `template_id`.
3. Call `POST /v1/chat/similar_to_embeddings` with `template_id` plus a `search_term` or `search_json`.
4. Use `matches` as recommendations.


<a id="document-18b95c84ac9185345aeec106a51945c4"></a>
## Runtime Modes > Docker Compose

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/docs/runtime-modes.md

Runs services as containers with Compose profiles:

- `core`
- `workers`
- `local-mongo`
- `minio`
- `local-media`
- `logger`


<a id="document-c8190144992eba4a2276a0fb9db61bb4"></a>
## Runtime Modes > Kubernetes

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/docs/runtime-modes.md

Uses the Helm chart under `deploy/helm/samsar`. Optional MongoDB and MinIO should be deployed as StatefulSets with PVCs.


<a id="document-bc32a94be5541a425dfddc2f1468fb34"></a>
## Runtime Modes > Local

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/docs/runtime-modes.md

Runs source services directly on the host. Optional MongoDB and MinIO can still be started with Docker for convenience.


<a id="document-f7007c911bb80c2536a21402f9f1f041"></a>
## Search

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/search.md

Samsar search is built on reusable embedding templates. A template is created from JSON records, URLs, or cleaned plain text. Queries search against a template and return matched records plus structured filter metadata.


<a id="document-2d57cad881162fb87773a847690bafff"></a>
## Search > Create an Index

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/search.md

| Endpoint | Input source | Notes |
| --- | --- | --- |
| `POST /v1/chat/create_embedding` | `records`, `data`, `items`, `json`, `documents`, or `urls` | Generic create endpoint. Records must be a non-empty array or URL input must contain at least one URL. |
| `POST /v1/chat/create_embedding_from_url` | `urls`, `url_list`, `source_urls`, or `url` | Crawls URL sources and returns processed/skipped/crawl metadata when available. |
| `POST /v1/chat/generate_embeddings_from_plain_text` | `plain_text`, `plain_texts`, `texts`, `documents`, `items`, `entries`, or text-like content fields | Creates templates from plain text. |
| `POST /v1/chat/update_embedding` | `template_id` plus records | Upserts submitted source IDs (replaces matching IDs and adds new IDs); other template records remain. |

Common optional fields:

| Field | Purpose |
| --- | --- |
| `name`, `embedding_name`, `template_name` | Human-readable template label. |
| `field_options`, `field_config`, `column_types` | Structured/unstructured field controls. |
| `ttl_minutes` | Positive integer TTL. Response includes `expires_at` when set. |
| `levels`, `crawl_levels`, `max_depth` | URL crawl depth controls for URL-based indexing. |

Create responses include `template_id`, `template_hash`, `hash_link`, record counts, structured fields, unstructured fields, and credit headers when applicable.


<a id="document-6e24e41861988768d682687c8a171c1c"></a>
## Search > Docker Services

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/search.md

| Service | Role |
| --- | --- |
| `processor` | Auth, input validation, embedding creation, search, filtering, credit headers, and status endpoints. |
| `mongo` | Stores embedding templates, records, status, user state, and credit state. |
| Provider | OpenAI embeds template content and search queries; Firecrawl supplies URL ingestion. |


<a id="document-0d2fad7de5e98640793a3b5626c24e19"></a>
## Search > Hosted Samsar.js

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/search.md

[Hosted search and embeddings](https://docs.samsar.one/chat-api#post-chatcreate_embedding) · [Embedding model matrix](model-matrix.md#embeddings) · [Recommendations](recommendations.md)

Start with Samsar.js for a managed index and query:

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const index = await samsar.createEmbedding({
  name: 'catalog',
  records: [{ id: 'camera-1', description: 'Compact camera for travel photography' }],
});
const results = await samsar.searchAgainstEmbedding({
  template_id: index.data.template_id,
  search_term: 'a lightweight travel camera',
});
console.log(results.data);
```

For large or queued ingestion, inspect [embedding status](https://docs.samsar.one/chat-api#get-chatembedding_status) before querying. In your own deployment, the current local embedding implementation requires an OpenAI key; URL crawling additionally requires Firecrawl. Those are local implementation requirements, not extra keys for a hosted Samsar.js caller.


<a id="document-35e546e3fd0164acb990676c686de279"></a>
## Search > Manage Templates

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/search.md

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/chat/embedding_templates` | List templates for the authenticated user. Accepts `limit` and `offset`. |
| `GET /v1/chat/embedding_status?template_id=...` | Check template status. |
| `POST /v1/chat/delete_embeddings` | Delete all records for a template. |
| `POST /v1/chat/delete_embedding` | Delete specific record IDs from a template. |


<a id="document-bf9e7d806bfd815d80af98faa30934f0"></a>
## Search > Operational Notes

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/search.md

- Search runs inside the processor API and depends on MongoDB state.
- Template search uses `text-embedding-3-large`. The separate `/v2/external/embeddings` vector endpoint uses `text-embedding-3-small` at 1536 dimensions; its output cannot be mixed into a large-model template index.
- The processor attempts indexed `$vectorSearch`; if unavailable, it loads the matching template records and scores cosine similarity in memory. Verify index support for the deployment before relying on this path for a large corpus.
- Optional reranking uses `OPENAI_RERANK_MODEL` (default `gpt-6-astra`), independently of the selected assistant model.
- Credit usage is returned in `x-credits-charged` and `x-credits-remaining` headers where the route charges credits.


<a id="document-437379f2f2d15697d732078ce00604f8"></a>
## Search > Query Search

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/search.md

Primary endpoints:

```text
POST /v1/chat/search_against_embedding
POST /v1/chat/search_against_embeddings
```

Required fields:

| Field | Meaning |
| --- | --- |
| `template_id` | The embedding template to query. |
| `search_term` or `query` | The natural-language search query. |

Optional fields:

| Field | Meaning |
| --- | --- |
| `search_params`, `search_filters`, `filter_payload`, `pre_filter` | Structured filter payload. |
| `filter_config`, `filter_options` | Filter interpretation options. |
| `structured_filters` or `filters` | Explicit structured filters. |
| `search_date` | Date context for time-sensitive search filters. |
| `limit` | Result limit. |
| `num_candidates` or `numCandidates` | Candidate count before final filtering/ranking. |
| `rerank` | Boolean reranking flag. |
| `include_raw` | Defaults to true. Include raw matching details. |

Response shape:

```json
{
  "template_id": "...",
  "template_name": "...",
  "structured_filters": {},
  "results": []
}
```


<a id="document-6d6952efb70e4c45dea27f20852bdfac"></a>
## Setup Wizard

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

The setup wizard is the browser-driven local Docker setup path. Node.js and
npm run inside its Docker image and are not required on the host.


<a id="document-60e15abb43b8730ce94f350710570dc7"></a>
## Setup Wizard > Data and Mail Modes

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

| Setting | Local default | Remote/external option |
| --- | --- | --- |
| Database | Authenticated local MongoDB with generated root and application passwords | A `mongodb://` or `mongodb+srv://` connection string. |
| Storage | MinIO with generated credentials and bucket `samsar-resources` | S3-compatible bucket, endpoint, region, keys, force-path-style flag, and optional CloudFront signing. |
| Browser media | Configured processor API (`http://localhost:3002/` by default) | Public CloudFront/CDN URL when external media publishing is enabled. |
| Mail | Disabled | SMTP or AWS SES. |


<a id="document-b9869278af6959b9ff0f69150b5c4ddc"></a>
## Setup Wizard > Domain and Reverse Proxy

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

The Domain step is optional. If skipped, Docker keeps the default local URLs and uses the local media tunnel when an external AI provider must fetch locally stored media.

When enabled, the wizard can configure nginx for:

| Access type | Use when | Provider media behavior |
| --- | --- | --- |
| Public domain/subdomain | You have DNS names for Studio and the processor API. Add A records for both names pointing to the machine IP in your DNS provider. | Browser media uses the processor URL; external adapters use the managed tunnel unless external S3/CloudFront is enabled. |
| Public IP | The server has a static public IPv4 address and DNS is not required. The wizard can detect and autofill the machine public IP. Studio uses `http://<public-ip>` and the processor API/media base uses `http://<public-ip>/api`. | Browser media uses the processor URL; external adapters use the managed tunnel unless external S3/CloudFront is enabled. |
| Private IP | The server is reachable only inside an intranet/VPC. The wizard can detect and autofill RFC1918 private IP candidates. Studio uses `http://<private-ip>` and the processor API/media base uses `http://<private-ip>/api`. | Internal users access the processor URL; external adapters use the managed tunnel. |

For production deployment without SSL, the machine must allow inbound access to port `80`. A detected public IP may be only the router or ISP address; Public IP mode is available only when that address can actually reach this machine on port `80`. If the public IP is not reachable, use Private IP for intranet access. SSL setup uses ports `80` and `443`; after certificate setup, the wizard closes port `80` if it opened that firewall rule itself. Any port opened by Samsar setup is recorded under `runtime/reverse-proxy/managed-firewall-ports.json` and closed before setup reset, delete, maintenance recreation, or Docker admin container recreation. Enabling public access exposes your instance, so set a strong admin password before opening it.

If public domains validate successfully, the wizard can optionally request and install a Let's Encrypt certificate. SSL setup requires the domains to resolve to the machine, port `80` to be reachable for certificate validation, and port `443` to be reachable for HTTPS access.


<a id="document-2fa7d1ffe72d5ee61597f0854aadf3f0"></a>
## Setup Wizard > Existing installations and updates

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

With Node.js and npm available on the host, `npm run deploy` or
`npm run docker:up` starts this same wizard before application image builds.
`npm run docker:restart` also starts the wizard first, and `npm run sync:restart`
syncs sibling projects before following that sequence. On a fresh install, finish
configuration and deployment in the wizard. With an existing
`runtime/config/samsar.config.json`, the command continues into the application
deployment once the wizard responds on port `8089`. Wizard startup failures stop
the command; application build failures leave the wizard available for recovery.

Container startup recreates existing services and removes Compose orphans while
preserving data volumes. If Docker reports a container-name conflict, the deployer
checks the conflicting container's Compose project, service, and checkout path,
then removes that container and retries with the already-built images. This covers
every conflicting container in the stack, including containers whose Compose
working directory is `deploy/compose`. Each conflicting name is recovered once;
a repeated conflict stops the operation so concurrent deployments cannot keep
replacing each other's containers. The same recovery applies to the media gateway,
reverse proxy, and processor restart during account recovery. The wizard also
prevents setup and update/restart operations from running at the same time. Other
deployment errors remain visible in the setup log.


<a id="document-12bcb901eb8c7f6541c60360b5b1c7f2"></a>
## Setup Wizard > Files Written

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

| File | Purpose |
| --- | --- |
| `runtime/config/samsar.config.json` | Main deployment configuration. |
| `runtime/config/available-models.json` | Enabled providers, models, actions, provider key/endpoint types, and derived audio availability. |
| `runtime/secrets/root.env` | Docker env file consumed by services, including the shared `KIMI_K3_API_KEY` for inference consumers. |
| `runtime/secrets/application.env` | Generated application signing and custom-adapter encryption secrets. |
| `runtime/secrets/mongo.env` | Generated MongoDB root and application credentials; the application account is embedded in the service `MONGO_URL`. |
| `runtime/secrets/minio.env` | Generated local MinIO administrator credentials. |
| `runtime/secrets/grafana.env` | Generated Grafana administrator credentials. |
| `runtime/secrets/setup-bootstrap.token` | Protected launcher token reused when the setup container is recreated; rotate it explicitly with `SAMSAR_SETUP_ROTATE_BOOTSTRAP_TOKEN=1`. |
| `runtime/secrets/setup-auth.hash` | Durable setup administrator password hash retained across setup reset. |
| `runtime/secrets/provider.credentials.json` | Mode-`0600` OpenRouter and validated Alibaba provider secrets plus Alibaba key/endpoint type. |
| `runtime/secrets/mail.credentials.json` | Sanitized and secret mail configuration when SMTP or SES is configured. |
| `runtime/reverse-proxy/nginx.conf` | Generated nginx config when the reverse proxy feature is enabled or safely disabled. |


<a id="document-dd877c0acd6148f3abd790ec890f3276"></a>
## Setup Wizard > Launch

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

Start it from the `samsar` monorepo root on Linux, macOS, or WSL:

```bash
./setup.sh
```

On Windows, use either native launcher:

```powershell
.\setup.ps1
```

```bat
setup.cmd
```

The launcher requires Docker Engine 20.10.0+, Docker Compose 2.20.0+, and
Buildx on native Linux, and Docker Desktop 4.84.0+ on macOS and Windows.
Missing installations receive current packages. When an existing installation
is below those compatibility floors, the launcher attempts an in-place update
through Docker Desktop, Homebrew, `winget`, or the existing Linux package
channel, as appropriate. It never changes the package family of an existing
Linux installation. macOS 4.84.0 includes the wake-from-sleep VM and VM-wake
API fixes that motivated the Desktop floor; Windows uses the same floor for a
consistent Desktop lifecycle. Set `SAMSAR_SETUP_INSTALL_DOCKER=0` to disable
automatic installation and updates; the launcher then prints a manual update
instruction for an incompatible installation.
Arch users are asked before the required full `pacman -Syu` transaction. WSL
uses Docker Desktop's Windows integration and does not install a second Engine
inside the distribution.
The Linux values are functional compatibility floors; keep Docker on a
current, vendor-supported patch release.
`npm run setup-wizard` remains an optional developer alias.


<a id="document-ccf7b9e19971960471e9828f91f2101b"></a>
## Setup Wizard > Local access

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

Local MongoDB uses `mongo:27017` between containers and an automatically allocated
loopback port for host access. This lets setup coexist with a host MongoDB already
listening on port `27017`. To find the allocated host port, run
`docker compose --env-file runtime/secrets/root.env -f deploy/compose/docker-compose.yml --profile local-mongo port mongo 27017`.
Set `MONGO_PORT` explicitly when invoking Compose if you require a fixed host port;
that port must be available. The setup wizard and deploy script read this shared
Compose configuration, so the automatic host-port allocation also applies when
retrying setup with an existing wizard container.

The command creates a protected bootstrap token, binds the setup wizard to
loopback, waits for it to respond, and opens an authenticated URL on
`http://localhost:8089`. The token is retained under `runtime/secrets` and
reused when the launcher recreates a destroyed setup container, so the same
browser profile can resume without another unlock stage. Existing session-only
tokens are migrated automatically. Set `SAMSAR_SETUP_ROTATE_BOOTSTRAP_TOKEN=1` to
invalidate previous bootstrap URLs and create a new token. For a remote host, use
`scripts/setup-wizard-remote.sh`; it retrieves the protected token over SSH and
opens an SSH tunnel. Set `SAMSAR_SETUP_OPEN_BROWSER=0` to skip browser
auto-open. On a fresh local installation, opening `http://localhost:8089` directly
also initializes browser access automatically, without a password or special
URL. This only applies to the launcher's loopback binding before an admin
password is configured; remote setups still use the authenticated launch link.

For managed workflows, start with [hosted Samsar.js](https://docs.samsar.one/) and a Samsar API key. Use this wizard when you want your own runtime. Compare the [full model matrix](model-matrix.md), then enable the Samsar adapter and any native/provider adapters required by your chosen models. Documentation order does not override the wizard’s validated runtime priority.


<a id="document-9f29e1a55e77d968add579a9ec18595a"></a>
## Setup Wizard > Provider Logic

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

At the top of Providers, **Enter values** remains the default and shows the existing credential fields. **Bash environment** switches those fields to variable references such as `$OPENAI_API_KEY` or `${OPENAI_API_KEY}`. The launcher forwards the standard provider variable names into the isolated setup service; the service resolves and validates them without returning raw values to the browser. To use a custom exported name, include it in `SAMSAR_SETUP_PROVIDER_ENV_NAMES` before launching, for example `SAMSAR_SETUP_PROVIDER_ENV_NAMES=LIVE_DEMO_KEY ./setup.sh`, then enter `$LIVE_DEMO_KEY` for the matching provider.

The wizard presents the Samsar API key first, followed by **Or add model or adapter keys to enable specific capabilities**. Model lists appear in per-provider tooltips, and each provider has a link to obtain credentials. **Continue** is highlighted when the entered provider combination covers the required capabilities; validation still runs when continuing.

| Mode | Providers | Behavior |
| --- | --- | --- |
| Samsar API key | Samsar | Enables supported managed model/action families. Native-only and credential-scoped exceptions remain separate. |
| Inference | OpenAI, Anthropic, Google Cloud, Alibaba Cloud, Kimi, OpenRouter | Agent reasoning, text, and vision; Google and Alibaba also enable their supported media capabilities. |
| GMICloud | GenBlaze gateway | Exposes exact model/operation mappings validated for the credential. |
| Media | fal, ElevenLabs, Runway | Dedicated image, video, speech, music, lip-sync, and sound-effect adapters. |

The provider list mirrors the runtime renderer and writes values that become `SAMSAR_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GMI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS_JSON_B64`, `KIMI_K3_API_KEY`, `ALIBABA_API_KEY`, `FAL_API_KEY`, `ELEVENLABS_API_KEY`, `RUNWAY_API_KEY` in `runtime/secrets/root.env`. Kimi validation runs through the processor provider-validation API; its browser field is redacted from persisted session state and must be re-entered after a resumed validation. OpenRouter validation checks authenticated key metadata, rejects management-only keys, and binds setup to a one-hour, single-use credential token. OpenRouter and Alibaba values are stored in mode-`0600` `runtime/secrets/provider.credentials.json`; Kimi is stored in the mode-`0600` runtime config. Validation tokens are excluded from persisted browser state and the copyable config preview. All backend Compose services consume the same `root.env`, so one Kimi secret covers the processor and every inference worker.

For Kimi requests, the provider order is native Kimi followed by Samsar. The exact native model is `kimi-k3` for both inference and vision, and all Kimi requests use high reasoning. OpenRouter is not part of the Kimi fallback chain.


<a id="document-2d62ee2b97f91f56463ab9c0194a6592"></a>
## Setup Wizard > Services Catalog

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

The wizard labels the available software factory services as:

| Category | Services |
| --- | --- |
| Core | Samsar Studio, Image Editor, Processor API, Setup wizard |
| Text API | Search API, Recommendations API |
| Inference | Inference, Assistant |
| Generative media | Image Generation, Video Generation, Lip Sync, TTS, Sound Effects, Music |
| Workers | Image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener |
| Infrastructure | Local MongoDB, local MinIO, media gateway, logger |


<a id="document-af20001e5de7d25519524595446fb50b"></a>
## Setup Wizard > Setup Run Lifecycle

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

When the wizard starts setup, the server performs these steps:

| Step | Meaning |
| --- | --- |
| `cleanup` | Clean previous containers. |
| `config` | Save deployment config under `runtime/config/samsar.config.json`. |
| `runtime` | Render `runtime/secrets/root.env`, durable infrastructure credential env files, and `runtime/config/available-models.json`. |
| `firewall` | Try to open required nginx reverse proxy ports: `80` for non-SSL, `80` and `443` for SSL. |
| `compose` | Build and start Docker containers. |
| `proxy` | Start nginx, optionally request Let's Encrypt certificates, and validate configured public or private access. |
| `media` | Publish/verify the local media gateway. |
| `processor` | Verify processor readiness at `/v1/health/ready`. |
| `client` | Verify Studio availability. |
| `login` | Prepare local login/setup redirect. |

Maintenance runs skip the initial cleanup/config flow and execute runtime render, image pull, optional firewall update, Compose update/restart, reverse-proxy verification, media verification, processor verification, and client verification.


<a id="document-01b4f689637eff7601c640a51d145958"></a>
## Setup Wizard > When to Use Manual Config Instead

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

Use the manual config path when you need deterministic reviewable changes to `runtime/config/samsar.config.json`, when you are testing provider edge cases, or when you are deploying to non-default infrastructure. After editing manually, run:

```bash
npm run config:render
npm run docker:setup-assets
npm run docker:up
```

The final command starts the setup wizard before deploying the manually saved
configuration, so port `8089` is available during the application build.

`npm run docker:setup-assets` is the one-time Docker host preparation step. It installs render/subtitle fonts into `runtime/fonts`, copies them into any running Samsar service containers, and refreshes Loki/Promtail/Grafana only when the logger service is enabled.


<a id="document-8f4f46bfe3cd84b93b023f91de3b34ac"></a>
## Setup Wizard > Wizard Steps

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/setup-wizard.md

| Step | Screen | What it gathers | Output |
| --- | --- | --- | --- |
| 1 | Providers | Samsar API key first; optional OpenAI, Anthropic, Google Cloud, Alibaba Cloud, Kimi, OpenRouter, GMICloud, fal, ElevenLabs, and Runway credentials | Provider config and model/action availability, including Qwen Image 3.0 Pro for standalone Alibaba Cloud standard PAYG credentials. |
| 2 | Services | Processor, setup wizard, image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener, logger | Docker service selection and local infrastructure flags. |
| 3 | Mail and Data | Local vs remote MongoDB, local MinIO vs external S3-compatible storage, static CDN URL, CloudFront signing fields, disabled/SMTP/SES mail | Database, storage, media, and mail config. |
| 4 | Domain | Optional nginx reverse proxy, public domain/subdomain, public IP, private IP, optional IP detection, optional firewall port opening, and optional Let's Encrypt SSL for validated public domains | Public or intranet access URLs for Studio and the processor API. |
| 5 | Admin | Organization name and admin/login details | Initial local setup/admin state. |


<a id="document-49481936c18d6a1746535a7d15f3d2ec"></a>
## Text Enhance

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-enhance.md

Text enhance turns a user message plus optional metadata into polished marketing copy. The route is implemented in the processor API and stores API chat session records for the user.


<a id="document-5875209c17707f741e8c930e33d9e66f"></a>
## Text Enhance > Auth

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-enhance.md

The route accepts a Samsar API key, user auth token, or app key where supported by the auth resolver.


<a id="document-07563ac4c718452b2c11a6895606ea99"></a>
## Text Enhance > Docker Services

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/text-enhance.md

| Service | Role |
| --- | --- |
| `processor` | Route, auth, credits, prompt construction, provider call, session persistence. |
| `mongo` | User, credit, and API chat state. |
| Provider | Compatible configured adapter for the selected model; see [provider routing](providers-and-models.md). |


<a id="document-505f0b363efe5b9e1045b5914c8e14ad"></a>
## Text Enhance > Endpoint

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-enhance.md

```text
POST /v1/chat/enhance
```

Health check:

```text
GET /v1/chat/health
```


<a id="document-2d38e7f5561d765e5c755a0da0ab50a7"></a>
## Text Enhance > Hosted Samsar.js

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-enhance.md

[Hosted enhancement API](https://docs.samsar.one/chat-api#post-chatenhance) · [Inference matrix](model-matrix.md#inference) · [Native inference adapters](providers-and-models.md)

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const copy = await samsar.enhanceMessage({
  message: 'Launch discount for a new skincare product',
  metadata: { audience: 'busy professionals', tone: 'warm and concise' },
  language: 'en',
  maxwords: 120,
});
console.log(copy.data.content);
```

The hosted client uses Samsar’s inference routing. A standalone installation can use the native adapter for its selected inference model, followed by the compatible configured alternatives.


<a id="document-bc8849f4f6b3f72dbd47b79c51d47a0d"></a>
## Text Enhance > Request Body

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-enhance.md

| Field | Required | Meaning |
| --- | --- | --- |
| `message` | Yes | Source message to enhance. Must be a non-empty string. |
| `metadata` | No | Object with private context such as audience, product, offer, tone, channel, differentiators, or constraints. The prompt uses this for context without echoing the fields. |
| `language` | No | Language code. Defaults to auto behavior when omitted. |
| `maxwords` or `maxWords` | No | Positive integer up to 1500. Defaults to 800. The generated target range is roughly 62.5-75 percent of this cap. |

Response:

```json
{
  "content": "..."
}
```


<a id="document-4c14206e4d54ac4f875b3b763cdac4d7"></a>
## Text Enhance > Runtime Behavior

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/text-enhance.md

| Step | Behavior |
| --- | --- |
| Credit charge | The processor charges the configured chat enhance credit cost before generation. |
| Inference model | The processor normalizes the selected inference model; current default is `gpt-6-astra`. See the [inference matrix](model-matrix.md#inference) for Claude, Gemini, Kimi, Qwen and reasoning options. |
| Provider routing | Standalone uses the selected model's compatible configured adapter order. Hosted `QWEN3.8` always uses OpenRouter; native Alibaba Qwen is Docker-only. |
| Persistence | Successful and failed API chat sessions are saved with metadata, input, output/error, model, and credit information. |
| Refunds | If generation fails after credit charge, the route attempts to refund the charged credits. |

Credit headers:

| Header | Meaning |
| --- | --- |
| `x-credits-charged` | Credits charged for the request. |
| `x-credits-remaining` | Remaining user credits when available. |


<a id="document-c2705a377e65bbc93ca3de7d9d5f3ac7"></a>
## Text to Video

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-to-video.md

Text-to-video creates an express video directly from a prompt. The processor validates the prompt, models, duration, subtitles, provider availability, and credits before queuing the video generation pipeline.


<a id="document-dd0330850f1617bdcd4c7961eb99a250"></a>
## Text to Video > Docker Pipeline

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/text-to-video.md

1. `processor` validates request shape, auth, credits, models, providers, and duration, then persists a durable builder job for a new or reused session.
2. The builder moderates the prompt, generates the theme once, and generates plus validates the narrative in up to three total attempts. A targeted repair path rewrites oversized speech items when possible.
3. The completed plan is persisted as scene and audio layers. `generator` scene-image jobs run in parallel with `audio-generator` speech jobs and one backing-track job; initial audio generation does not include sound effects.
4. `express-video-listener` joins the image, speech, and music gates, charges completed stages, handles configured step-mode pauses, and queues eligible image-to-video work.
5. `ai-video-layer-generator` submits and polls motion, lip-sync, and later sound-effect jobs. After base motion, the listener runs reflow, conditional lip sync, optional sound effects, optional narrator avatar, and best-effort transcript generation in order.
6. `frames-processor` renders linear layers or branch-path entries into frame manifests.
7. `video-generator` composes frames and enabled audio with FFmpeg, uploads the result, and persists the final URL.
8. The listener charges the final pipeline stage, settles the receipt or external request, records the terminal status, and sends the optional terminal webhook. The result is served by the local media gateway or external storage/CDN configuration.


<a id="document-d4effa462189ff4d20745ba590d76b8e"></a>
## Text to Video > Endpoints

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-to-video.md

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/video/text_to_video` | Main internal/authenticated user route. |
| `POST /v1/video/create` | Older create route that accepts `{ "input": ... }`. |
| `POST /v2/text_to_video` | `v2` alias delegated to the video route. |
| `POST /v1/external_users/text_to_video` | External-user scoped route. |
| `POST /v2/external/video/text_to_video` | `v2` external video route. |
| `POST /v2/video/step/text_to_video` | Step-video text-to-video route. |


<a id="document-29e16cf711781edc1ee18df3c10682cb"></a>
## Text to Video > Hosted Samsar.js

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-to-video.md

[Hosted Video API](https://docs.samsar.one/video#post-videotext_to_video) · [Image model matrix](model-matrix.md#image) · [Video model matrix](model-matrix.md#video) · [Adapter deployment](providers-and-models.md)

Start with `samsar-js` against the hosted API. The same workflow can run through a standalone processor with compatible adapters.

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const job = await samsar.createVideoFromText({
  prompt: 'A welcoming introduction to a boutique hotel.',
  image_model: 'GPTIMAGE2.5',
  video_model: 'RUNWAYML',
  duration: 30,
  tts_model: 'OPENAI',
  backingtrack_model: 'LYRIA3',
});
console.log(job.data.request_id);
```

This creates a planned multi-stage video. The selected `video_model` animates scene images; it does not have to be a raw text-to-video model.


<a id="document-b4bc006c7d84d634abbb70379aee9884"></a>
## Text to Video > Optional Fields

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-to-video.md

| Field | Meaning |
| --- | --- |
| `session_id` | Attach request to an existing session when supported. |
| `enable_subtitles` or `add_subtitles` | Boolean subtitle control. |
| `configuration`, `config`, `model_config`, `custom_model_config`, `custom_models` | Custom model/provider configuration. |
| `webhookUrl` | Best-effort terminal success/failure callback URL. |
| External-user fields | If external-user request signals are present, the route delegates to the external-user handler. |

Deprecated `video_model_sub_type` and `videoModelSubType` fields are stripped before validation.


<a id="document-7722a449d8fef388faa03a256bc5928f"></a>
## Text to Video > Required Fields

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-to-video.md

| Field | Rule |
| --- | --- |
| `prompt` | Required non-empty string. Maximum length is 4000 characters. |
| `image_model` | Required express image model. |
| `video_model` | Required express video model. |
| `duration` | Number from 10 to 240 seconds. |

The route accepts either a raw JSON body or an `input` object:

```json
{
  "input": {
    "prompt": "A cinematic product launch video for a new running shoe",
    "image_model": "NANOBANANAPRO",
    "video_model": "RUNWAYML",
    "duration": 30
  },
  "webhookUrl": "https://example.com/webhooks/samsar"
}
```


<a id="document-8c628052f4393d4a6c9b107df32da2d0"></a>
## Text to Video > Status

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-to-video.md

Use these status endpoints after receiving a request/session ID:

```text
GET /v2/status?request_id=<request-id>
GET /v2/status_detailed?request_id=<request-id>
GET /v1/external_users/status?request_id=<external-request-id>
```

Final local Docker media links usually resolve under:

```text
http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```


<a id="document-8724280fc9bca40f9a380a100dc7f894"></a>
## Text to Video > Supported Model Keys

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/text-to-video.md

Choose from the [image matrix](model-matrix.md#image) and [video matrix](model-matrix.md#video). Those tables are generated from the same Express and branching allowlists used by this checkout.

| Stage | Request field | Where to compare |
| --- | --- | --- |
| Planning | `inference_model` | [Inference and vision](model-matrix.md#inference) |
| Scene images | `image_model` | [Express-capable image models](model-matrix.md#image) |
| Scene motion | `video_model` | [Express-capable video models](model-matrix.md#video) |
| Narration | `tts_model` | [Speech values](model-matrix.md#speech) |
| Backing track | `backingtrack_model` | [Music](model-matrix.md#music) |

**Native exception:** `QWENIMAGE3PRO` requires standalone Alibaba pay-as-you-go access. **Provider-billed exception:** Seedance 2.0 requires fal or the exact validated GenBlaze route. Named custom image adapters use the returned `CUSTOM_TEXT_TO_IMAGE:<adapter-id>` key.

Start with the hosted [pricing table](https://docs.samsar.one/pricing#video-models) for managed billing. Provider-billed standalone routes use their own provider account and should not be assigned a fixed Samsar rate from a static table.

```js
const available = await samsar.getSupportedTextToVideoModels();
console.log(available.data);
```

For a standalone processor, the same discovery endpoint is `http://localhost:3002/v1/video/supported_models`. It reports the filtered Express view, not the entire Studio catalog.


<a id="document-41d11b3bf0e9611a96244314d93ff7a3"></a>
## Video model billing and retries

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/video-model-billing.md

Studio AI-video generation, lip-sync layers, sound-effect layers, rerolled scenes and direct hosted model endpoints settle individual completed calls. See [final customer output prices](https://docs.samsar.one/pricing#video-model-calls).

Production agent pipelines retain their fixed stage prices. Standalone editions waive local credit debits. When a standalone agent or Studio worker calls hosted Samsar through Samsar.js, the hosted endpoint records the charge once.


<a id="document-31d4ff900b7e7dd30df2d00c0a5635f5"></a>
## Video model billing and retries > Endpoint scope

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/video-model-billing.md

| Operation | Hosted route | Receipt |
| --- | --- | --- |
| Image-to-video | `/v2/external/video/image_to_video`, `/direct_image_to_video` | Completed model call |
| Direct text-to-video | `/v2/external/video/direct_text_to_video` | Completed model call |
| Lip sync | `/v2/external/video/lip_sync` | Completed model call |
| Sound-effect layer | `/v2/external/video/sound_effect` | Completed model call |
| Scene reroll | `/v2/reroll-layers` | Each completed image and media-model call |
| Full production agent workflow | `/v2/external/video/text_to_video` and narrative/render workflows | Existing fixed stage pricing |

Direct text-to-video accepts `VEO3.1`, `VEO3.1FAST`, `HAILUOPRO`, and `KLINGTXTTOVID4`. It does not run narrative planning or generate starting images.


<a id="document-54d004a2b4224be159317318bc607b7d"></a>
## Video model billing and retries > Fal-backed lip-sync pricing

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/video-model-billing.md

Each completed hosted model call has one charge, using the billing unit below.

| Model key | Final hosted charge |
| --- | --- |
| [`SYNCLIPSYNC`](https://fal.ai/models/fal-ai/sync-lipsync/v3) | 16 credits per measured output second |
| [`LATENTSYNC`](https://fal.ai/models/fal-ai/latentsync) | 24 credits per video through 40 seconds; 0.6 credits per output second above 40 seconds |
| [`KLINGLIPSYNC`](https://fal.ai/models/fal-ai/kling-video/lipsync/audio-to-video) | 1.68 credits per billable input-video second, in 5-second blocks |
| [`CREATIFYLIPSYNC`](https://fal.ai/models/creatify/lipsync) | 2 credits per measured output second |
| [`HUMMINGBIRDLIPSYNC`](https://fal.ai/models/fal-ai/tavus/hummingbird-lipsync/v0) | 15 credits per requested second, historical fallback |

LatentSync's above-40-second rate applies to the entire output. Hummingbird retains a historical application rate; its current provider tariff has not been verified.


<a id="document-5dd21ef975711d6b491bb7f5eac94ee9"></a>
## Video model billing and retries > Fal-backed video sound-effect pricing

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/video-model-billing.md

| Model key | Final hosted charge | Duration and samples |
| --- | --- | --- |
| [`MMAUDIOV2`](https://fal.ai/models/fal-ai/mmaudio-v2) | 0.12 credits per submitted audio second | Defaults to eight seconds. |
| [`MIRELOAI`](https://fal.ai/models/mirelo-ai/sfx1.6/video-to-video) | 1.2 credits per submitted second per sample | New calls request one sample; older calls may have two. |

Mirelo's sample multiplier is an application billing assumption and has not been invoice-verified. Audio-only sound effects use their separate [audio endpoint prices](https://docs.samsar.one/external-requests#audio).


<a id="document-942c7b5214d7828ef514efe10f819b0e"></a>
## Video model billing and retries > Final AI-video output prices

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/video-model-billing.md

These prices apply to individual model calls on the named native adapter. Per-second prices refer to generated output before scene trimming or padding. Multiple completed outputs are billable individually.

| Model | Adapter | Configuration | Unit | Credits |
| --- | --- | --- | --- | --- |
| `RUNWAYML` | Runway | Gen-4.5 | second | 14.4 |
| `VEO3.1 / VEO3.1I2V` | Google Cloud | 720p / 1080p, video | second | 24 |
| `VEO3.1 / VEO3.1I2V` | Google Cloud | 720p / 1080p, video + audio | second | 48 |
| `VEO3.1FAST / VEO3.1I2VFAST` | Google Cloud | 720p, video | second | 9.6 |
| `VEO3.1FAST / VEO3.1I2VFAST` | Google Cloud | 720p, video + audio | second | 12 |
| `VEO3.1FAST / VEO3.1I2VFAST` | Google Cloud | 1080p, video | second | 12 |
| `VEO3.1FAST / VEO3.1I2VFAST` | Google Cloud | 1080p, video + audio | second | 14.4 |
| `HAPPYHORSEI2V` | Alibaba international | Happy Horse 1.1, 720p | second | 16.8 |
| `HAPPYHORSEI2V` | Alibaba China / global | Happy Horse 1.1, 720p | second | 14.85228 |
| `HAILUOPRO` | MiniMax | Hailuo 02, 768p, 6 seconds | clip | 33.6 |
| `HAILUOPRO` | MiniMax | Hailuo 02, 768p, 10 seconds | clip | 67.2 |

Supported Fal AI-video routes have [their own final model-call rates](https://docs.samsar.one/pricing#video-model-calls). Kling 4 (`KLINGIMGTOVID4` / `KLINGTXTTOVID4`) costs 18.84 credits per generated second at 720p, without native audio. It accepts 5–30-second clips in five-second steps. Full workflow pricing is separate: Kling 4 remains 36 credits/sec; Seedance 2.5 is 60 for Agent/Vidgenie and 50 for the standard Express rate class.

Submitted per-second options and measured Seedance video-token output determine the completed charge. Hosted direct adapter-billed Fal requests for Haiper 2.0, Magi Distilled, 10-second Pika 2.2, 121-frame Wan 2.2 5B and PixVerse durations other than five or eight seconds lack a verified tariff and stop before a paid submission.


<a id="document-355c17d268c6f2ac85f6e48d876dafaf"></a>
## Video model billing and retries > Provider configuration

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/video-model-billing.md

Fal-backed lip-sync, video sound-effect and supported AI-video calls use versioned model tariff constants. Completion billing calculates the charge from the saved request configuration and output metadata; it does not fetch Fal Billing Events or a model price during processing. A model or configuration without a verified tariff is not eligible for a new hosted paid call.

The GenBlaze gateway forwards media cost metadata when available. Seedance 2.0 can use saved configuration-specific rates if the response omits cost. Other GMICloud calls require valid cost metadata; missing metadata leaves billing pending. Keep the original request key while confirmation is pending. Do not infer a GMICloud charge from another adapter's table.


<a id="document-18dd500a1eaff21f334a3d5e0e96964d"></a>
## Video model billing and retries > Regression checks

Source class: monorepo_docs; audience: operator; freshness: current.

Sources: repo:samsar/pages/video-model-billing.md

Run the AI-video worker test suite, processor video-billing and reroll tests, Express stage-billing tests, and the gateway media-billing tests. These cover concurrent callbacks, provider cost confirmation, balance/ledger recovery, checkpoint failures, delivery retries, standalone waiver and preservation of production agent prices.


<a id="document-defb69f662e4a2c288144a2a01ab012c"></a>
## Video model billing and retries > Retry contract

Source class: monorepo_docs; audience: public; freshness: current.

Sources: repo:samsar/pages/video-model-billing.md

Supply a stable `Idempotency-Key` or `client_request_id`. Replays retain their original job and charge; changed payloads return `409`. Use a new key for an intentional new call. Status responses include `creditsCharged`, `remainingCredits` and `billingStatus`.

The worker retains a completed clip before billing and delivery. Billing confirmation, ledger repair and delivery retries reuse that clip. Existing prepaid jobs are not charged again. Financial receipts have no queue TTL; background reconciliation continues after queue cleanup.


<a id="document-be5c0e9aae1314819c22eb167d3da954"></a>
## Add Lip-Sync to Generative Scenes in SamsarOne Studio — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/n-lip-sync-to-generative-video-projects-with-samsarone-studio/

For lip-sync, keep the intended speaker's mouth visible throughout the spoken segment. Create or select a base video, add the corresponding speech, and align the speech inside the scene boundaries before generating lip-sync. Review the result for speaker identity, mouth visibility and synchronization before final composition.


<a id="document-2aff6af1b732d4160990748a067b9ff2"></a>
## Bring myths to life with Samsar — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/bring-myths-to-life-with-samsar/

For mythological videos, identify the source tradition, episode, key characters and intended emotional arc. State whether the treatment is faithful adaptation or creative interpretation. Add the setting, visual style, key actions and desired ending; review generated dialogue and events against the source when fidelity matters.


<a id="document-2e76def8afc7572d40bd9769d57290a4"></a>
## Comparing the Inference Engines — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/comparing-the-inference-engines/

When exact narration matters, provide the required lines explicitly and state whether additions or paraphrases are allowed. Review the generated transcript before rendering. For dialogue and lip-sync shots, keep the intended speaker visually clear and avoid camera changes that make the speaking subject ambiguous.


<a id="document-4e2fac6539f4efff05146db16616ee93"></a>
## Consistency in generative-video projects — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/character-theme-consistency-in-generative-video-projects-2/

Maintain a reusable description of each character's distinguishing features, clothing and proportions, together with the setting and visual style. Change only the attributes required by the scene. Start from consistent scene images before animation, and review identity and style continuity across the sequence.


<a id="document-ed2b42ebdaa9e53435fc25bc87dedeb8"></a>
## Ed-Tech content with Samsar T2V agent — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/ed-tech-content-with-samsar-t2v-agent/

For educational prompts, ask for one clearly scoped concept at a time, with an ordered explanation and concise readable labels. Specify the tone and intended audience. Verify diagrams, equations and narration and correct inaccuracies before sharing the video.


<a id="document-cff7311529bcb5ed6779e146930d3859"></a>
## GPT Image 2 is here- We tried giving it some of the hardest battles — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/gpt-image-2-is-here-we-tried-giving-it-some-of-the-hardest-battles/

For technical explainers, name the concept and learning objective, define the visual relationships, and supply exact short labels. Keep text stable and inside safe margins. Specify restrained motion for diagrams and avoid invented equations or decorative visuals that misrepresent the topic. Review scientific claims and rendered labels before publication.


<a id="document-872347db1a5ff2f3977d3e4165a445ba"></a>
## Generative Documentaries from Extinct Worlds — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/generative-documentaries-from-extinct-worlds/

For prehistoric documentary ideas, specify the period, environment, animal and a single observable event. State whether the film uses narration, character dialogue or only natural sound, and whether it remains entirely in the past. Editorial review should distinguish fossil-supported facts from speculative reconstruction.


<a id="document-4f4fd98a187d9efdd451176d6a3b3ce9"></a>
## Increased quality, faster renders and more model options with the Samsar the One Text/Image-List to Video Agent — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/i-quality-faster-render-more-model-options-narrator-avatar-with-the-samsar-the-one-text-image-list-to-video-agent/

Review previews for narrative direction, pacing, narration and scene flow. Choose voice style to match the content. After generation, inspect branding, CTA legibility and scene transitions, then make targeted Studio edits before the final render.


<a id="document-9a7fdbd66f84f222228867d901677c4e"></a>
## On-Demand Dynamic Ed-Tech with the Samsar Framework — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/on-demand-dynamic-ed-tech-with-the-samsar-framework/

An educational brief should define the learner, topic, learning objective and ordered visual explanation. Keep on-screen terminology and narration consistent. Have a subject expert review factual claims, diagrams and captions before distribution, and use Studio to correct individual scenes.


<a id="document-63a6993bf0f5080f6cb6fe923ab9e338"></a>
## Text-to-Movie in one-shot with generative agentic pipelines — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/one-shot-movie-creation-with-lipsync-2/

Plan a coherent narrative before refining individual shots. Keep character descriptions and visual themes consistent across scenes. After the first render, review continuity, narration, scene transitions and audio, then edit the specific assets that need improvement.


<a id="document-6e02442426676fb2d7130e00132e98dd"></a>
## The AI Food Video Challenge — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/the-ai-food-video-challenge/

For cooking or craft videos, provide the ingredients or materials, ordered actions, setting and intended visual style. Describe object placement and interactions clearly so the animation follows the process. Review continuity between steps and rerender a scene when objects, tools or actions are inconsistent.


<a id="document-4a41089b19ad062841e7b2e225089eb9"></a>
## The Agent is now in Public Beta — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/the-agent-is-live-in-public-beta/

A useful creation workflow is to describe the story, visual style and cinematic intent first, generate an initial video, then review individual scenes in Studio. Refine weak scenes and pacing before producing the final export.


<a id="document-f866b58029b6cae91e9c0d98b65b070a"></a>
## What's new with Samsar Omni agent — creative workflow guidance

Source class: creative_guidance; audience: public; freshness: editorial.

Sources: https://samsar.one/blog/whats-new-with-samsar-omni-agent/

For image-list marketing videos, preserve the supplied product or activity identity and use listing metadata to guide the narrative. Describe restrained camera movement, plausible object motion and what must remain unchanged, including existing text and logos. Review CTA readability and the final link destination before publishing.


<a id="document-d42cc95decd57a44cc83015fc201e0ae"></a>
## Add Lip-Sync to Generative Scenes in SamsarOne Studio

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/n-lip-sync-to-generative-video-projects-with-samsarone-studio/

The February 2025 lip-sync guide explains the sequence of speaker image, animated base video, speech layer and lip-sync generation. Its default model, UI labels and promotional credits are historical. The enduring prerequisites are a clearly visible speaking subject and speech timing contained within the scene.


<a id="document-330e60c69b3ffb4c24517c40d2d1d381"></a>
## BackBlaze B2 cloud and GenBlaze adapter are now configurable in Samsar.

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/backblaze-b2-cloud-and-genblaze-adapter-are-now-configurable-in-samsar/

The August 2026 integration report describes Backblaze B2 storage and the GenBlaze adapter through GMI Cloud, configuration via the setup wizard, adapter fallbacks and integration challenges. Statements about public buckets, provider concurrency, Seedance availability and supported model coverage describe that release and must not be treated as current deployment requirements.


<a id="document-f591f9ea2b1f38625a1686b7a8adefaf"></a>
## Bring myths to life with Samsar

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/bring-myths-to-life-with-samsar/

This article presents Journey to the West demonstrations and compares how selected inference models interpreted the same mythological setting. It encourages iterating on ideas and prompts before rendering. Its model preferences and performance observations are subjective historical demonstrations, not guarantees of textual accuracy.


<a id="document-9bbffac08b3dbf954551f26f8c58b7c7"></a>
## Comparing the Inference Engines

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/comparing-the-inference-engines/

This historical comparison uses poetry recitation to discuss narrative fidelity, structured outputs, creativity and vision judgments across inference engines. The observations are anecdotal, model-version-specific demonstrations. They should not establish a current ranking, current pricing or guaranteed behavior.


<a id="document-1876f5cfd9f402e80879b92551e048ee"></a>
## Consistency in generative-video projects

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/character-theme-consistency-in-generative-video-projects-2/

This January 2025 guide compares prompt-based consistency with fine-tuned models and LoRA. It discusses defining characters, places, settings and style across scenes and describes the Studio controls of that release. Model preferences and exact tab names are historical.


<a id="document-8ed1c931500570bf976d29b7586cded8"></a>
## Deploy Sandboxed Generative API servers with Model Composable Payload

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/deploy-sandboxed-generative-api-servers-with-model-composable-payload/

This article explains the model-composable deployment concept: high-level video workflows and lower-level generation APIs can be served from a self-hosted installation with configured adapters. It discusses native, third-party and Samsar API configuration and custom integrations. Fixed model counts and setup-screen positions are historical; current setup documentation and code define supported configuration.


<a id="document-9f8550542a90cca8b2b18d1647b3402c"></a>
## Ed-Tech content with Samsar T2V agent

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/ed-tech-content-with-samsar-t2v-agent/

This educational-content showcase describes using text-to-video for technical learning material and illustrates the importance of aligning narrative, diagrams and animation. Model choices and performance claims are historical examples.


<a id="document-1b468b4b6a48110a29a5efe0dbf61640"></a>
## GPT Image 2 is here- We tried giving it some of the hardest battles

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/gpt-image-2-is-here-we-tried-giving-it-some-of-the-hardest-battles/

A historical launch demonstration of GPT Image 2 in Vidgenie. Technical examples include differentiable physics, the Langlands program and causal inference, combining image generation with video animation. The article emphasizes readable text, precise labels and specific visual instructions. Model versions and model recommendations are those of the publication date, not the current catalog.


<a id="document-2a61036cfc1384be8390176c37771b2d"></a>
## Generative Documentaries from Extinct Worlds

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/generative-documentaries-from-extinct-worlds/

This showcase uses generated prehistoric documentary scenes, including marine predators, Titanoboa, mammoths and Ophthalmosaurus. It demonstrates controlling whether the video stays in a prehistoric setting, includes narration, or alternates between modern presenter scenes and reconstructed past scenes. Model selections and quality judgments are historical.


<a id="document-45d7a2e93eacb6069e4b0b572c5eaa78"></a>
## Increased quality, faster renders and more model options with the Samsar the One Text/Image-List to Video Agent

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/i-quality-faster-render-more-model-options-narrator-avatar-with-the-samsar-the-one-text-image-list-to-video-agent/

The May 2026 release describes live previews, configurable agent models, narrator avatars, branding and CTA options, and Studio post-processing. It contains a historical pricing table, model defaults and timing estimates; current code and documentation supersede those values.


<a id="document-bbb3e77974faa1de27771eaa644230c2"></a>
## Managed APIs for deploying SoTA Search and Recommendation systems with minimal configuration requirements

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/managed-apis-for-deploying-sota-search-and-recommendation-systems-with-minimal-configuration-requirements/

This April 2026 article introduces managed search and recommendation APIs, including creation and update of document embeddings, URL ingestion, similarity retrieval and optional downstream augmentation. It describes an OpenAI-backed service. That existing commercial API is separate from the assistant's new static local knowledge base and does not imply an OpenAI dependency for assistant retrieval.


<a id="document-39ea5fbc193419565fd744a0ffd7d70f"></a>
## On-Demand Dynamic Ed-Tech with the Samsar Framework

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/on-demand-dynamic-ed-tech-with-the-samsar-framework/

This educational showcase illustrates water cycles, Earth's magnetic field, printing history and continental motion. It discusses post-processing by subject experts and generating metadata for distribution. Claims of perfect model accuracy, quoted prices and model recommendations are historical marketing claims, not validated guarantees.


<a id="document-0d917725d589687ccac3434d4e480490"></a>
## Our Full-Stack Video Creation Agent API is Now Live

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/our-movie-creator-agent-api-is-now-in-ga-2/

The March 2025 public alpha announcement presents end-to-end movie creation with configurable inference, image and video models, progress polling and optional completion notifications. It describes editing the generated result in Studio. Endpoint spellings, plan requirements, timing estimates and model guidance are historical; current API contracts take precedence.


<a id="document-962069d130c8bf286d45b9dc9c8560c6"></a>
## QWEN 3.7 Inference and Native Alibaba Cloud integration is here

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/qwen-3-8-inference-and-native-alibaba-cloud-integration-is-here/

This Alibaba Cloud integration post describes native and intermediary adapter options and Qwen, Happy Horse and WAN demonstrations. It includes a correction distinguishing Qwen token-plan availability from production API availability. The title, URL and model mentions differ, so current model IDs and availability must be resolved from code and current docs.


<a id="document-560eabf510d152007dcdb388cf53c60a"></a>
## SeeDance 2.5 is now configurable in the prompt-to-visualize anything framework

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/seedance-2-5-is-now-configurable-in-the-prompt-to-visualize-anything-framework/

The August 2026 release announces configurable Seedance 2.5 in the text-to-video framework. It is historical evidence of the integration and demonstrations at publication time, not an authority for current model routing, availability, duration limits or charges.


<a id="document-74f11c89983f5595a3da1bdba0e26883"></a>
## Text-to-Movie in one-shot with generative agentic pipelines

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/one-shot-movie-creation-with-lipsync-2/

The January 2025 introduction explains the top-down agent concept: a user idea becomes a narrative and scene structure, scene images, animation, speech and a composed video. It describes iterative image quality checks and editing the first render at scene, image, audio and text levels. Exact retry counts, providers and render limits belong to the original release.


<a id="document-c4af576603b708ec021812daa53c2f14"></a>
## The AI Food Video Challenge

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/the-ai-food-video-challenge/

A cooking-video comparison demonstrates recipe sequences and regional settings using different inference models with a shared video model. It discusses narrative adherence, initial-frame descriptions, physics and correcting individual animation issues. Rendering times, model versions and provider selections reflect the demonstration date.


<a id="document-c10f63d6b0724d6ff1cf095ed74c878f"></a>
## The Agent is now in Public Beta

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/the-agent-is-live-in-public-beta/

The March 2025 public beta announcement describes prompt-driven video creation through the API and then-named VidGPT creator, with subsequent scene edits in Studio. Its duration limits, success-rate claims, model lists, aspect-ratio recommendations and promotions describe the beta release.


<a id="document-7cb053105676a3721c1698af76d5123f"></a>
## The Samsar project is now generally available, open-source under MIT license

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/the-samsar-project-is-now-generally-available-open-source-under-mit-license/

The July 2026 announcement presents the Samsar project as an MIT-licensed open-source video framework with deployable agent, editor and API functionality. Its release-specific model lists and deployment descriptions are background material; current repository documentation defines installation details.


<a id="document-32d7d7a7481424a988b47fd89c26eb3a"></a>
## What's new with Samsar Omni agent

Source class: blog_history; audience: public; freshness: historical.

Sources: https://samsar.one/blog/whats-new-with-samsar-omni-agent/

An April 2026 overview of agent workflow improvements, configurable inference, image and video models, voices, subtitles, image-list marketing videos, branding, translation and joining videos. Prices, supported-language counts and model defaults in this article are historical; use current documentation and reviewed implementation for those details.
