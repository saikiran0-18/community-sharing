const API_BASE = "http://127.0.0.1:3000";

let currentRequestId = null;
let currentRequestDetails = null;

/* ---------------- BASIC ---------------- */

function getToken() {
    return localStorage.getItem("token") || "";
}

function getCurrentUser() {
    return JSON.parse(localStorage.getItem("currentUser") || "null");
}

async function apiFetch(path, options = {}) {
    const headers = options.headers || {};

    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    const token = getToken();
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
    });

    let data;
    try {
        data = await response.json();
    } catch {
        const text = await response.text();
        throw new Error(text || "Server returned invalid response");
    }

    if (!response.ok) {
        throw new Error(data.message || "Request failed");
    }

    return data;
}

function logoutUser() {
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    window.location.href = "login.html";
}

/* ---------------- AUTH ---------------- */

async function registerUser(event) {
    event.preventDefault();

    try {
        const name = document.getElementById("regName").value.trim();
        const email = document.getElementById("regEmail").value.trim();
        const password = document.getElementById("regPassword").value;
        const role = document.getElementById("regRole").value;
        const location = document.getElementById("regLocation").value.trim();

        const data = await apiFetch("/api/register", {
            method: "POST",
            body: JSON.stringify({ name, email, password, role, location })
        });

        localStorage.setItem("token", data.token);
        localStorage.setItem("currentUser", JSON.stringify(data.user));

        window.location.href = data.user.role === "owner" ? "owner.html" : "request.html";
    } catch (error) {
        alert(error.message);
    }
}

async function loginUser(event) {
    event.preventDefault();

    try {
        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;

        const data = await apiFetch("/api/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        localStorage.setItem("token", data.token);
        localStorage.setItem("currentUser", JSON.stringify(data.user));

        window.location.href = data.user.role === "owner" ? "owner.html" : "request.html";
    } catch (error) {
        alert(error.message);
    }
}

/* ---------------- AI ---------------- */

async function recommendToolWithAI() {
    try {
        const userNeedBox = document.getElementById("userNeed");
        const toolField = document.getElementById("toolName");
        const durationField = document.getElementById("duration");
        const pickupDateField = document.getElementById("pickupDate");
        const returnDateField = document.getElementById("returnDate");
        const messageField = document.getElementById("borrowerMessage");

        if (!userNeedBox) {
            alert("AI need box not found.");
            return;
        }

        const userNeed = userNeedBox.value.trim();

        if (!userNeed) {
            alert("Please enter your need first.");
            return;
        }

        const data = await apiFetch("/api/ai/recommend-tool", {
            method: "POST",
            body: JSON.stringify({ userNeed })
        });

        if (toolField) toolField.value = data.toolName || "";
        if (durationField) durationField.value = data.duration || "";
        if (pickupDateField) pickupDateField.value = data.pickupDate || "";
        if (returnDateField) returnDateField.value = data.returnDate || "";
        if (messageField) messageField.value = data.borrowerMessage || "";
    } catch (error) {
        alert(error.message);
    }
}

/* ---------------- REQUESTS ---------------- */

async function postBorrowerRequest(event) {
    event.preventDefault();

    try {
        const toolName = document.getElementById("toolName")?.value.trim() || "";
        const duration = document.getElementById("duration")?.value.trim() || "";
        const pickupDate = document.getElementById("pickupDate")?.value || "";
        const returnDate = document.getElementById("returnDate")?.value || "";
        const borrowerMessage = document.getElementById("borrowerMessage")?.value.trim() || "";

        const data = await apiFetch("/api/requests", {
            method: "POST",
            body: JSON.stringify({
                toolName,
                duration,
                pickupDate,
                returnDate,
                borrowerMessage
            })
        });

        alert(data.message);

        const form = document.getElementById("requestForm");
        if (form) form.reset();

        loadBorrowerRequests();
    } catch (error) {
        alert(error.message);
    }
}

async function loadBorrowerRequests() {
    const table = document.getElementById("borrowerTable");
    if (!table) return;

    try {
        const requests = await apiFetch("/api/requests/borrower");
        table.innerHTML = "";

        if (!requests.length) {
            table.innerHTML = `<tr><td colspan="5">No requests found</td></tr>`;
            return;
        }

        requests.forEach((request) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${request.tool_name || ""}</td>
                <td>${request.duration || ""}</td>
                <td>${request.pickup_date || ""}</td>
                <td>${request.return_date || ""}</td>
                <td>${request.status || ""}</td>
            `;
            row.addEventListener("click", function () {
                openRequest(request.id);
            });
            table.appendChild(row);
        });
    } catch (error) {
        table.innerHTML = `<tr><td colspan="5">${error.message}</td></tr>`;
    }
}

async function loadOwnerRequests() {
    const table = document.getElementById("requestTable");
    if (!table) return;

    try {
        const requests = await apiFetch("/api/requests/owner");
        table.innerHTML = "";

        if (!requests.length) {
            table.innerHTML = `<tr><td colspan="7">No tool requests found</td></tr>`;
            return;
        }

        requests.forEach((request) => {
            let actionButtons = "";

            if (request.status === "Pending") {
                actionButtons = `
                    <button type="button" class="action-btn" onclick="event.stopPropagation(); updateRequestStatus('${request.id}', 'Accepted')">Accept</button>
                    <button type="button" class="action-btn" onclick="event.stopPropagation(); updateRequestStatus('${request.id}', 'Rejected')">Reject</button>
                `;
            } else if (request.status === "Payment Submitted") {
                actionButtons = `
                    <button type="button" class="action-btn" onclick="event.stopPropagation(); confirmPayment()">Confirm Payment</button>
                `;
            } else if (request.status === "Confirmed") {
                actionButtons = `
                    <button type="button" class="action-btn" onclick="event.stopPropagation(); updateRequestStatus('${request.id}', 'Borrowed')">Mark Borrowed</button>
                `;
            } else if (request.status === "Borrowed") {
                actionButtons = `
                    <button type="button" class="action-btn" onclick="event.stopPropagation(); updateRequestStatus('${request.id}', 'Completed')">Mark Completed</button>
                `;
            } else {
                actionButtons = `
                    <button type="button" class="action-btn" onclick="event.stopPropagation(); openRequest('${request.id}')">View</button>
                `;
            }

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${request.tool_name || ""}</td>
                <td>${request.duration || ""}</td>
                <td>${request.pickup_date || ""}</td>
                <td>${request.return_date || ""}</td>
                <td>${request.borrower_name || ""}</td>
                <td>${request.status || ""}</td>
                <td>${actionButtons}</td>
            `;

            row.addEventListener("click", function () {
                openRequest(request.id);
            });

            table.appendChild(row);
        });
    } catch (error) {
        table.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
    }
}

async function updateRequestStatus(requestId, status) {
    try {
        const data = await apiFetch(`/api/requests/${requestId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status })
        });

        alert(data.message);
        await loadOwnerRequests();
        await openRequest(requestId);
    } catch (error) {
        alert(error.message);
    }
}

async function openRequest(requestId) {
    try {
        currentRequestId = requestId;

        const data = await apiFetch(`/api/requests/${requestId}/details`);
        currentRequestDetails = data;

        const selectedText = document.getElementById("selectedRequestText");
        const detailsBox = document.getElementById("requestDetailsBox");

        if (selectedText) {
            selectedText.textContent = `${data.tool_name || ""} | ${data.status || ""} | ${data.borrower_name || data.owner_name || ""}`;
        }

        if (detailsBox) {
            detailsBox.innerHTML = `
                <p><strong>Tool:</strong> ${data.tool_name || ""}</p>
                <p><strong>Duration:</strong> ${data.duration || ""}</p>
                <p><strong>Pickup Date:</strong> ${data.pickup_date || ""}</p>
                <p><strong>Return Date:</strong> ${data.return_date || ""}</p>
                <p><strong>Status:</strong> ${data.status || ""}</p>
                <p><strong>Borrower Name:</strong> ${data.borrower_name || ""}</p>
                <p><strong>Borrower Email:</strong> ${data.borrower_email || ""}</p>
                <p><strong>Borrower Location:</strong> ${data.borrower_location || ""}</p>
                <p><strong>Owner Name:</strong> ${data.owner_name || ""}</p>
                <p><strong>Owner Email:</strong> ${data.owner_email || ""}</p>
                <p><strong>Owner Location:</strong> ${data.owner_location || ""}</p>
                <p><strong>Message:</strong> ${data.borrower_message || ""}</p>
            `;
        }

        await loadMessages();
        await loadPaymentInfo();
        await loadReviewsForSelectedRequest();
    } catch (error) {
        alert(error.message);
    }
}

/* ---------------- CHAT ---------------- */

async function loadMessages() {
    const chatBox = document.getElementById("chatBox");
    if (!chatBox || !currentRequestId) return;

    try {
        const messages = await apiFetch(`/api/messages/${currentRequestId}`);
        chatBox.innerHTML = "";

        if (!messages.length) {
            chatBox.innerHTML = "<p>No messages yet.</p>";
            return;
        }

        messages.forEach((msg) => {
            chatBox.innerHTML += `
                <div class="chat-message" style="margin-bottom:10px; padding:8px; border-bottom:1px solid #ddd;">
                    <strong>${msg.sender_name || ""}:</strong> ${msg.message || ""}
                    <br>
                    <small>${msg.created_at ? new Date(msg.created_at).toLocaleString() : ""}</small>
                </div>
            `;
        });

        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (error) {
        chatBox.innerHTML = `<p>${error.message}</p>`;
    }
}

async function sendChatMessage() {
    try {
        if (!currentRequestId) {
            alert("Please select a request first.");
            return;
        }

        const chatInput = document.getElementById("chatInput");
        if (!chatInput) {
            alert("Chat input not found.");
            return;
        }

        const message = chatInput.value.trim();
        if (!message) {
            alert("Please type a message.");
            return;
        }

        await apiFetch("/api/messages", {
            method: "POST",
            body: JSON.stringify({
                requestId: currentRequestId,
                message
            })
        });

        chatInput.value = "";
        await loadMessages();
    } catch (error) {
        alert(error.message);
    }
}

/* ---------------- VIDEO VERIFICATION ---------------- */

async function uploadVerification() {
    try {
        if (!currentRequestId) {
            alert("Please select a request first.");
            return;
        }

        const fileInput = document.getElementById("verificationVideo");
        if (!fileInput || !fileInput.files || !fileInput.files[0]) {
            alert("Please choose a video file first.");
            return;
        }

        const formData = new FormData();
        formData.append("requestId", currentRequestId);
        formData.append("video", fileInput.files[0]);

        const data = await apiFetch("/api/verifications", {
            method: "POST",
            body: formData
        });

        alert(data.message);
        fileInput.value = "";
    } catch (error) {
        alert(error.message);
    }
}

/* ---------------- PAYMENTS ---------------- */

async function createPaymentSetup() {
    try {
        if (!currentRequestId) {
            alert("Please select a request first.");
            return;
        }

        const rentAmount = document.getElementById("ownerRentAmount")?.value.trim() || "";
        const depositAmount = document.getElementById("ownerDepositAmount")?.value.trim() || "";
        const ownerUpiId = document.getElementById("ownerUpiId")?.value.trim() || "";
        const ownerNote = document.getElementById("ownerNote")?.value.trim() || "";
        const ownerQrImage = document.getElementById("ownerQrImage")?.files?.[0] || null;

        if (!rentAmount || !depositAmount || !ownerUpiId) {
            alert("Please fill rent amount, deposit amount, and owner UPI ID.");
            return;
        }

        const formData = new FormData();
        formData.append("requestId", currentRequestId);
        formData.append("rentAmount", rentAmount);
        formData.append("depositAmount", depositAmount);
        formData.append("ownerUpiId", ownerUpiId);
        formData.append("ownerNote", ownerNote);

        if (ownerQrImage) {
            formData.append("ownerQrImage", ownerQrImage);
        }

        const data = await apiFetch("/api/payments/setup", {
            method: "POST",
            body: formData
        });

        alert(data.message);
        await loadPaymentInfo();
        await openRequest(currentRequestId);
    } catch (error) {
        alert(error.message);
    }
}

async function loadPaymentInfo() {
    const paymentInfo = document.getElementById("paymentInfo");
    if (!paymentInfo || !currentRequestId) return;

    try {
        const payment = await apiFetch(`/api/payments/${currentRequestId}`);

        paymentInfo.innerHTML = `
            <p><strong>Rent Amount:</strong> ${payment.rentAmount ?? ""}</p>
            <p><strong>Deposit Amount:</strong> ${payment.depositAmount ?? ""}</p>
            <p><strong>Owner UPI ID:</strong> ${payment.ownerUpiId || ""}</p>
            ${payment.ownerQrImageUrl ? `
    <p><strong>Owner QR Code:</strong></p>
    <a href="${API_BASE}${payment.ownerQrImageUrl}" target="_blank">
        <img src="${API_BASE}${payment.ownerQrImageUrl}" alt="Owner QR Code" style="max-width:220px; margin:10px 0; border:1px solid #ccc; border-radius:8px; cursor:pointer;">
    </a>
` : ""}
            <p><strong>Owner Note:</strong> ${payment.ownerNote || ""}</p>
            <p><strong>Borrower UPI App:</strong> ${payment.borrowerUpiApp || ""}</p>
            <p><strong>Borrower Transaction ID:</strong> ${payment.borrowerTransactionId || ""}</p>
            <p><strong>Status:</strong> ${payment.status || ""}</p>
            ${payment.borrowerPaymentProofUrl ? `<p><strong>Payment Proof:</strong> <a href="${API_BASE}${payment.borrowerPaymentProofUrl}" target="_blank">View Proof</a></p>` : ""}
        `;
    } catch (error) {
        paymentInfo.innerHTML = `<p>${error.message}</p>`;
    }
}

async function submitBorrowerPayment() {
    try {
        if (!currentRequestId) {
            alert("Please select a request first.");
            return;
        }

        const borrowerUpiApp = document.getElementById("borrowerUpiApp")?.value || "";
        const borrowerTransactionId = document.getElementById("borrowerTransactionId")?.value.trim() || "";
        const proofFile = document.getElementById("paymentProof")?.files?.[0] || null;

        if (!borrowerUpiApp || !borrowerTransactionId) {
            alert("Please fill UPI app and transaction ID.");
            return;
        }

        const formData = new FormData();
        formData.append("requestId", currentRequestId);
        formData.append("borrowerUpiApp", borrowerUpiApp);
        formData.append("borrowerTransactionId", borrowerTransactionId);
        if (proofFile) {
            formData.append("proof", proofFile);
        }

        const data = await apiFetch("/api/payments/submit", {
            method: "POST",
            body: formData
        });

        alert(data.message);
        await loadPaymentInfo();
        await openRequest(currentRequestId);
    } catch (error) {
        alert(error.message);
    }
}

async function confirmPayment() {
    try {
        if (!currentRequestId) {
            alert("Please select a request first.");
            return;
        }

        const data = await apiFetch("/api/payments/confirm", {
            method: "POST",
            body: JSON.stringify({
                requestId: currentRequestId
            })
        });

        alert(data.message);
        await loadPaymentInfo();
        await openRequest(currentRequestId);
    } catch (error) {
        alert(error.message);
    }
}

/* ---------------- REVIEWS ---------------- */

async function submitReview() {
    try {
        if (!currentRequestId) {
            alert("Please select a request first.");
            return;
        }

        const rating = document.getElementById("reviewRating")?.value || "";
        const comment = document.getElementById("reviewComment")?.value.trim() || "";

        if (!rating) {
            alert("Please select a rating.");
            return;
        }

        const data = await apiFetch("/api/reviews", {
            method: "POST",
            body: JSON.stringify({
                requestId: currentRequestId,
                rating,
                comment
            })
        });

        alert(data.message);

        const reviewRating = document.getElementById("reviewRating");
        const reviewComment = document.getElementById("reviewComment");
        if (reviewRating) reviewRating.value = "";
        if (reviewComment) reviewComment.value = "";

        await loadReviewsForSelectedRequest();
    } catch (error) {
        alert(error.message);
    }
}

async function loadReviewsForSelectedRequest() {
    const reviewsBox = document.getElementById("reviewsBox");
    if (!reviewsBox || !currentRequestDetails) return;

    try {
        let userId = "";

        const currentUser = getCurrentUser();
        if (!currentUser) return;

        if (currentUser.role === "owner") {
            userId = currentRequestDetails.borrower_email ? "" : "";
            userId = currentRequestDetails.id ? (currentRequestDetails.borrowerId || "") : "";
        }

        if (currentUser.role === "borrower") {
            userId = currentRequestDetails.id ? (currentRequestDetails.acceptedOwnerId || "") : "";
        }

        if (!userId) {
            reviewsBox.innerHTML = "<p>Reviews will appear here after completion.</p>";
            return;
        }

        const data = await apiFetch(`/api/reviews/user/${userId}`);

        reviewsBox.innerHTML = `
            <p><strong>Average Rating:</strong> ${Number(data.averageRating || 0).toFixed(1)}</p>
            <p><strong>Total Reviews:</strong> ${data.totalReviews || 0}</p>
        `;

        if (data.reviews && data.reviews.length) {
            data.reviews.forEach((review) => {
                reviewsBox.innerHTML += `
                    <div style="margin-top:10px; padding:8px; border-bottom:1px solid #ddd;">
                        <p><strong>${review.reviewer_name || ""}</strong> (${review.reviewer_role || ""})</p>
                        <p>Rating: ${review.rating || ""}</p>
                        <p>${review.comment || ""}</p>
                    </div>
                `;
            });
        }
    } catch (error) {
        reviewsBox.innerHTML = `<p>${error.message}</p>`;
    }
}

/* ---------------- LOAD ---------------- */

window.addEventListener("load", () => {
    if (document.getElementById("borrowerTable")) {
        loadBorrowerRequests();
    }

    if (document.getElementById("requestTable")) {
        loadOwnerRequests();
    }
});