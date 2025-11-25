import pdfplumber
import csv
import re

# Define the input PDF file and output CSV file
pdf_path = "checking.pdf"
csv_path = "transactions.csv"

def clean_text(text):
    return " ".join(text.split())  # Normalize spaces

transactions = []
current_year = "24"  # Default year (fallback)

# Open the PDF and extract text
with pdfplumber.open(pdf_path) as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if not text:
            continue

        lines = text.split("\n")
        temp_transaction = None

        for line in lines:
            match = re.match(r"(\d{1,2}/\d{2})\s+(.+?)\s+(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s+(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)", line)

            if match:
                if temp_transaction:
                    transactions.append(temp_transaction)

                date, description, amount, balance = match.groups()
                full_date = f"{date}/{current_year}"
                temp_transaction = [full_date, clean_text(description), amount.replace(',', ''), balance.replace(',', '')]
            elif temp_transaction:
                temp_transaction[1] += " " + clean_text(line)

        if temp_transaction:
            transactions.append(temp_transaction)

# Write extracted transactions to CSV
with open(csv_path, "w", newline="") as file:
    writer = csv.writer(file)
    writer.writerow(["Date", "Description", "Amount", "Balance"])
    writer.writerows(transactions)

print(f"Transactions have been extracted and saved to {csv_path}")
